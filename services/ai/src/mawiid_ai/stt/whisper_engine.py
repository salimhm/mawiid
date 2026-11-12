"""faster-whisper engine. Runs on CPU or GPU; Whisper is not a streaming model,
so the voice detector cuts the stream into phrases and each phrase is transcribed."""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Iterable, Mapping

import numpy as np

from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind, SttEngine, SttError, SttStream, Transcript, to_float32
from mawiid_ai.stt.config import ALL_LANGUAGES, LANGUAGES, VadSettings, WhisperSettings
from mawiid_ai.stt.dialect import ArabicVariant
from mawiid_ai.stt.postprocess import (
    clean_text,
    collapse_repeats,
    implausible_length,
    is_hallucination,
    normalize_for_compare,
    repeats_context,
)
from mawiid_ai.stt.vad import SpeechProbModel, VadSegmenter

log = logging.getLogger(__name__)

# Whisper's own measure of a decoding stuck in a loop ("Sssss...", one word repeated).
_MAX_COMPRESSION_RATIO = 2.4
# Shorter finals are not given to the next phrase as a prompt: a few words ("I don't know.")
# are the easiest for Whisper to echo back over silence.
_MIN_CONTEXT_CHARS = 15
# The same final twice in a row is Whisper looping over silence, when it is at least this long.
# Shorter repeats ("نعم", "oui", "OK") are things people really say twice.
_MIN_REPEATED_FINAL_CHARS = 20
_ARABIC_VARIANTS = ("ar-SA", "ar-MA")

# Nudges Whisper toward punctuated Mandarin; without it Chinese output often has no punctuation.
_PROMPTS = {"zh": "以下是普通话的句子。"}


# Whisper pads every phrase to 30 s and encodes all of it, so a 2 s phrase costs as much as a
# 30 s one: 7 s with the Darija model on a laptop CPU. Encoding the phrase plus some silence is
# 3-4 times faster. Below ~10 s in total the decoder starts repeating itself on short phrases.
_MIN_FRAMES = 1000
_TRAILING_FRAMES = 300
_MAX_FRAMES = 3000


def pad_to_phrase(features: np.ndarray) -> np.ndarray:
    frames = min(_MAX_FRAMES, max(_MIN_FRAMES, features.shape[-1] + _TRAILING_FRAMES))
    frames += frames % 2
    if features.shape[-1] >= frames:
        return features[..., :frames]
    padding = [(0, 0)] * features.ndim
    padding[-1] = (0, frames - features.shape[-1])
    return np.pad(features, padding)


def previous_text(context: str, text: str, limit: int) -> str:
    """The last ``limit`` characters of what was said, cut at a word boundary."""
    if limit <= 0:
        return ""
    joined = f"{context} {text}".strip()
    if len(joined) <= limit:
        return joined
    tail = joined[-limit:]
    space = tail.find(" ")
    return tail[space + 1 :] if 0 <= space < len(tail) - 1 else tail


def pick_language(probs: Mapping[str, float], current: str, languages: Iterable[str], switch_prob: float) -> str:
    """The language of a phrase among ``languages`` (Mawiid codes), from Whisper's probabilities
    (model codes, e.g. "fr"): ``current``, unless Whisper is at least ``switch_prob`` sure, counting
    only these languages, that it is another one: a phrase Whisper is unsure about keeps the language.
    Languages sharing a model code (ar-SA and ar-MA) are never switched between."""
    by_code: dict[str, str] = {}
    for language in languages:
        by_code.setdefault(ALL_LANGUAGES[language].model_code, language)
    # ar-SA and ar-MA share "ar" and Whisper cannot tell them apart: keep the speaker's. Darija is
    # reached only when it is picked (spoken or caption language), never guessed from detection.
    by_code[ALL_LANGUAGES[current].model_code] = current
    total = sum(probs.get(code, 0.0) for code in by_code)
    if total <= 0:
        return current
    best = max(by_code, key=lambda code: probs.get(code, 0.0))
    if probs.get(best, 0.0) / total < switch_prob:
        return current
    return by_code[best]


def _default_cpu_threads() -> int:
    return max(4, (os.cpu_count() or 4) * 2 // 3)


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
        # Transcribes this engine's Arabic phrases when set (the Darija model, which also writes
        # Standard Arabic): the words then tell Darija from Standard Arabic (stt/dialect.py).
        self.dialect_engine: WhisperEngine | None = None
        self.settings = settings
        self.vad_settings = vad_settings
        self.device, self.compute_type = _resolve_device(settings)
        self.partials = settings.partials == "1"
        if self.device == "cpu":
            import faster_whisper.transcribe

            # GPUs keep the stock 30 s, which is fast enough there.
            faster_whisper.transcribe.pad_or_trim = pad_to_phrase
        log.info(
            "loading %s (%s) on %s (%s), partials %s",
            name, settings.model, self.device, self.compute_type, "on" if self.partials else "off",
        )
        self._model = WhisperModel(
            settings.model,
            device=self.device,
            compute_type=self.compute_type,
            cpu_threads=settings.cpu_threads or (_default_cpu_threads() if self.device == "cpu" else 0),
        )
        # CTranslate2 handles concurrent calls, but on CPU they just fight over cores.
        self._lock = threading.Lock() if self.device == "cpu" else None

    def supports(self, language: str) -> bool:
        return language in self._languages

    def open_stream(
        self, language: str, time_offset: float = 0.0, detect: bool = True, vad_model: SpeechProbModel | None = None
    ) -> SttStream:
        if not self.supports(language):
            raise SttError(f"{self.name} does not support {language}")
        return WhisperStream(self, language, time_offset, vad_model, detect=detect)

    def transcribe(self, audio: np.ndarray, language: str, partial: bool = False, context: str = "") -> str:
        """Transcribe one phrase of 16 kHz float32 audio. ``context``: what the speaker said just before."""
        code = LANGUAGES[language].model_code
        try:
            if self._lock is not None:
                with self._lock:
                    return self._transcribe(audio, language, code, partial, context)
            return self._transcribe(audio, language, code, partial, context)
        except Exception as exc:
            raise SttError(f"{self.name} failed: {exc}") from exc

    def language_probs(self, audio: np.ndarray) -> dict[str, float]:
        """Whisper's probability, per model language code ("fr", "ar", ...), that the phrase is in it."""
        try:
            if self._lock is not None:
                with self._lock:
                    _, _, probs = self._model.detect_language(audio)
            else:
                _, _, probs = self._model.detect_language(audio)
        except Exception as exc:
            raise SttError(f"{self.name} language detection failed: {exc}") from exc
        return dict(probs)

    def _transcribe(self, audio: np.ndarray, language: str, code: str, partial: bool, context: str) -> str:
        s = self.settings
        min_logprob = LANGUAGES[language].min_segment_logprob
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
            initial_prompt=" ".join(p for p in (_PROMPTS.get(code), context) if p) or None,
        )
        # faster-whisper drops a segment only when it is both likely silence and low-confidence;
        # its made-up phrases are confident, so either sign alone is enough here.
        kept = (
            segment.text
            for segment in segments
            if segment.no_speech_prob <= s.max_no_speech_prob
            and segment.compression_ratio <= _MAX_COMPRESSION_RATIO
            and (min_logprob is None or segment.avg_logprob >= min_logprob)
        )
        text = clean_text("".join(kept), language)
        if not text or is_hallucination(text) or repeats_context(text, context):
            return ""
        return collapse_repeats(text)


class WhisperStream(SttStream):
    def __init__(
        self,
        engine: WhisperEngine,
        language: str,
        time_offset: float,
        vad_model: SpeechProbModel | None = None,
        detect: bool = True,
    ) -> None:
        self._engine = engine
        self._language = language
        self._offset = time_offset
        self._vad = VadSegmenter(engine.vad_settings, vad_model)
        self._partial_every = int(engine.settings.partial_interval_s * SAMPLE_RATE)
        self._last_partial_at = 0
        self._last_partial_text = ""
        self._partial_segment = -1
        self._next_partial_at = 0.0
        self._context = ""  # the end of the previous final, prompted to Whisper
        self._last_final = ""  # normalized, to drop Whisper repeating itself over silence
        self._arabic = ArabicVariant(language if language in _ARABIC_VARIANTS else "ar-SA")
        # Whisper can't hear Darija from Standard Arabic; the words of each phrase decide, when
        # the language is detected and both are on.
        self._tell_arabic_apart = (
            detect
            and engine.settings.detect_language
            and all(code in LANGUAGES for code in _ARABIC_VARIANTS)
            and getattr(engine, "dialect_engine", None) is not None
        )
        settings = engine.settings
        candidates = [code for code in LANGUAGES if engine.supports(code)] if detect and settings.detect_language else []
        # Detection only makes sense between languages the model tells apart.
        self._candidates = candidates if len({LANGUAGES[c].model_code for c in candidates}) > 1 else []
        self._detect_min = int(settings.detect_min_s * SAMPLE_RATE)
        self._partial_language: str | None = None  # detected for the phrase being spoken

    def push_audio(self, audio: np.ndarray | bytes) -> list[Transcript]:
        results = [r for seg in self._vad.feed(to_float32(audio)) if (r := self._final(seg.audio, seg.start_sample))]
        partial = self._maybe_partial()
        if partial is not None:
            results.append(partial)
        return results

    def flush(self) -> list[Transcript]:
        return [r for seg in self._vad.flush() if (r := self._final(seg.audio, seg.start_sample))]

    @property
    def language(self) -> str:
        """The language the speaker is speaking now: the one picked, until another is detected."""
        return self._language

    def _detect(self, audio: np.ndarray) -> str:
        if not self._candidates or len(audio) < self._detect_min:
            return self._language
        probs = self._engine.language_probs(audio)
        return pick_language(probs, self._language, self._candidates, self._engine.settings.detect_switch_prob)

    def _final(self, audio: np.ndarray, start_sample: int) -> Transcript | None:
        self._last_partial_text = ""
        self._partial_language = None
        # The whole phrase tells the language better than the start the partials heard.
        language = self._known_variant(self._detect(audio))
        if language != self._language:
            log.info("stt: speaker switched %s -> %s", self._language, language)
            self._language = language
            self._context = ""  # text in another language would push Whisper back to it
        prompted = LANGUAGES[language].context_prompt
        engine = self._engine_for(language)
        text = engine.transcribe(audio, language, context=self._context if prompted else "")
        if not text:
            return None
        if implausible_length(text, len(audio) / SAMPLE_RATE):
            log.info("stt: dropped %d characters made up over %.1f s of audio", len(text), len(audio) / SAMPLE_RATE)
            return None
        normalized = normalize_for_compare(text)
        if normalized == self._last_final and len(normalized) >= _MIN_REPEATED_FINAL_CHARS:
            return None
        self._last_final = normalized
        if self._tell_arabic_apart and language in _ARABIC_VARIANTS:
            variant = self._arabic.update(text)
            if variant != language:
                log.info("stt: speaker switched %s -> %s (from the words)", language, variant)
                language = self._language = variant
        if prompted and len(text) >= _MIN_CONTEXT_CHARS:
            self._context = previous_text(self._context, text, self._engine.settings.context_chars)
        return self._result(ResultKind.FINAL, text, language, start_sample, start_sample + len(audio), engine.name)

    def _maybe_partial(self) -> Transcript | None:
        if not self._engine.partials or not self._vad.in_speech:
            return None
        start = self._vad.segment_start
        if start != self._partial_segment:  # a new phrase started
            self._partial_segment = start
            self._last_partial_at = start
            self._last_partial_text = ""
            self._partial_language = None
        now = self._vad.samples_seen
        if now - self._last_partial_at < self._partial_every or time.monotonic() < self._next_partial_at:
            return None
        self._last_partial_at = now
        audio = self._vad.current_audio()
        started = time.monotonic()
        if self._partial_language is None and len(audio) >= self._detect_min:
            self._partial_language = self._known_variant(self._detect(audio))  # once per phrase; the final checks again
        language = self._partial_language or self._language
        context = self._context if language == self._language and LANGUAGES[language].context_prompt else ""
        engine = self._engine_for(language)
        text = engine.transcribe(audio, language, partial=True, context=context)
        finished = time.monotonic()
        self._next_partial_at = finished + (finished - started) * (1 / self._engine.settings.partial_max_load - 1)
        if not text or text == self._last_partial_text:
            return None
        self._last_partial_text = text
        return self._result(ResultKind.PARTIAL, text, language, start, start + len(audio), engine.name)

    def _known_variant(self, language: str) -> str:
        """Detection hears "Arabic": which one this speaker was last heard speaking."""
        if self._tell_arabic_apart and language in _ARABIC_VARIANTS:
            return self._arabic.current
        return language

    def _engine_for(self, language: str):
        dialect = getattr(self._engine, "dialect_engine", None)
        if dialect is not None and language in _ARABIC_VARIANTS:
            return dialect
        return self._engine

    def _result(
        self, kind: ResultKind, text: str, language: str, start_sample: int, end_sample: int, engine: str
    ) -> Transcript:
        return Transcript(
            kind=kind,
            text=text,
            language=language,
            start=self._offset + start_sample / SAMPLE_RATE,
            end=self._offset + end_sample / SAMPLE_RATE,
            engine=engine,
        )
