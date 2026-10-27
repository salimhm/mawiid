"""faster-whisper engine. Runs on CPU or GPU; Whisper is not a streaming model,
so the voice detector cuts the stream into phrases and each phrase is transcribed."""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterable

import numpy as np

from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind, SttEngine, SttError, SttStream, Transcript, to_float32
from mawiid_ai.stt.config import LANGUAGES, VadSettings, WhisperSettings
from mawiid_ai.stt.postprocess import clean_text
from mawiid_ai.stt.vad import SpeechProbModel, VadSegmenter

log = logging.getLogger(__name__)

# Nudges Whisper toward punctuated Mandarin; without it Chinese output often has no punctuation.
_PROMPTS = {"zh": "以下是普通话的句子。"}


def _resolve_device(settings: WhisperSettings) -> tuple[str, str]:
    device = settings.device
    if device == "auto":
        import ctranslate2

        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    compute_type = settings.compute_type
    if compute_type == "default":
        compute_type = "float16" if device == "cuda" else "int8"
    return device, compute_type


class WhisperEngine(SttEngine):
    def __init__(
        self,
        settings: WhisperSettings,
        vad_settings: VadSettings,
        name: str = "whisper",
        languages: Iterable[str] | None = None,
    ) -> None:
        """``languages`` limits a fine-tuned model to what it was trained on (default: all)."""
        from faster_whisper import WhisperModel

        self.name = name
        self._languages = set(languages) if languages is not None else set(LANGUAGES)
        self.settings = settings
        self.vad_settings = vad_settings
        self.device, self.compute_type = _resolve_device(settings)
        self.partials = settings.partials == "1" or (settings.partials == "auto" and self.device == "cuda")
        log.info(
            "loading %s (%s) on %s (%s), partials %s",
            name, settings.model, self.device, self.compute_type, "on" if self.partials else "off",
        )
        self._model = WhisperModel(
            settings.model,
            device=self.device,
            compute_type=self.compute_type,
            cpu_threads=settings.cpu_threads,
        )
        # CTranslate2 handles concurrent calls, but on CPU they just fight over cores.
        self._lock = threading.Lock() if self.device == "cpu" else None

    def supports(self, language: str) -> bool:
        return language in self._languages

    def open_stream(
        self, language: str, time_offset: float = 0.0, vad_model: SpeechProbModel | None = None
    ) -> SttStream:
        if not self.supports(language):
            raise SttError(f"{self.name} does not support {language}")
        return WhisperStream(self, language, time_offset, vad_model)

    def transcribe(self, audio: np.ndarray, language: str, partial: bool = False) -> str:
        """Transcribe one phrase of 16 kHz float32 audio."""
        code = LANGUAGES[language].model_code
        try:
            if self._lock is not None:
                with self._lock:
                    return self._transcribe(audio, language, code, partial)
            return self._transcribe(audio, language, code, partial)
        except Exception as exc:
            raise SttError(f"{self.name} failed: {exc}") from exc

    def _transcribe(self, audio: np.ndarray, language: str, code: str, partial: bool) -> str:
        s = self.settings
        segments, _ = self._model.transcribe(
            audio,
            language=code,
            beam_size=s.partial_beam_size if partial else s.beam_size,
            # Retrying at higher temperatures fixes bad finals but is too slow for partials.
            temperature=0.0 if partial else [0.0, 0.2, 0.4, 0.6],
            vad_filter=False,  # our own VAD already cut the phrase
            condition_on_previous_text=False,
            without_timestamps=True,
            no_speech_threshold=s.max_no_speech_prob,
            log_prob_threshold=s.min_avg_logprob,
            initial_prompt=_PROMPTS.get(code),
        )
        return clean_text("".join(segment.text for segment in segments), language)


class WhisperStream(SttStream):
    def __init__(
        self,
        engine: WhisperEngine,
        language: str,
        time_offset: float,
        vad_model: SpeechProbModel | None = None,
    ) -> None:
        self._engine = engine
        self._language = language
        self._offset = time_offset
        self._vad = VadSegmenter(engine.vad_settings, vad_model)
        self._partial_every = int(engine.settings.partial_interval_s * SAMPLE_RATE)
        self._last_partial_at = 0
        self._last_partial_text = ""
        self._partial_segment = -1

    def push_audio(self, audio: np.ndarray | bytes) -> list[Transcript]:
        results = [r for seg in self._vad.feed(to_float32(audio)) if (r := self._final(seg.audio, seg.start_sample))]
        partial = self._maybe_partial()
        if partial is not None:
            results.append(partial)
        return results

    def flush(self) -> list[Transcript]:
        return [r for seg in self._vad.flush() if (r := self._final(seg.audio, seg.start_sample))]

    def _final(self, audio: np.ndarray, start_sample: int) -> Transcript | None:
        self._last_partial_text = ""
        text = self._engine.transcribe(audio, self._language)
        if not text:
            return None
        return self._result(ResultKind.FINAL, text, start_sample, start_sample + len(audio))

    def _maybe_partial(self) -> Transcript | None:
        if not self._engine.partials or not self._vad.in_speech:
            return None
        start = self._vad.segment_start
        if start != self._partial_segment:  # a new phrase started
            self._partial_segment = start
            self._last_partial_at = start
            self._last_partial_text = ""
        now = self._vad.samples_seen
        if now - self._last_partial_at < self._partial_every:
            return None
        self._last_partial_at = now
        audio = self._vad.current_audio()
        text = self._engine.transcribe(audio, self._language, partial=True)
        if not text or text == self._last_partial_text:
            return None
        self._last_partial_text = text
        return self._result(ResultKind.PARTIAL, text, start, start + len(audio))

    def _result(self, kind: ResultKind, text: str, start_sample: int, end_sample: int) -> Transcript:
        return Transcript(
            kind=kind,
            text=text,
            language=self._language,
            start=self._offset + start_sample / SAMPLE_RATE,
            end=self._offset + end_sample / SAMPLE_RATE,
            engine=self._engine.name,
        )
