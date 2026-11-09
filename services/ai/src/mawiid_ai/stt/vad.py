"""Voice activity detection: splits a live audio stream into spoken phrases.

Uses the Silero VAD model bundled with faster-whisper (ONNX, CPU, no PyTorch),
but keeps the model state between calls so it works on a live stream.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from mawiid_ai.stt.base import SAMPLE_RATE
from mawiid_ai.stt.config import VadSettings

WINDOW = 512  # samples per VAD decision (32 ms at 16 kHz), fixed by the model


class SpeechProbModel(Protocol):
    def __call__(self, window: np.ndarray) -> float: ...
    def reset(self) -> None: ...


class SileroVad:
    """Stateful Silero VAD: one instance per stream, the ONNX session is shared."""

    _CONTEXT = 64
    _session = None

    def __init__(self) -> None:
        if SileroVad._session is None:
            from faster_whisper.vad import get_vad_model

            SileroVad._session = get_vad_model().session
        self.reset()

    def reset(self) -> None:
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._context = np.zeros(self._CONTEXT, dtype=np.float32)

    def __call__(self, window: np.ndarray) -> float:
        model_input = np.concatenate([self._context, window])[np.newaxis, :]
        probs, self._h, self._c = self._session.run(None, {"input": model_input, "h": self._h, "c": self._c})
        self._context = window[-self._CONTEXT :]
        return float(probs[0])


@dataclass(frozen=True, slots=True)
class SpeechSegment:
    audio: np.ndarray  # float32, 16 kHz
    start_sample: int  # position in the stream
    forced: bool  # True when cut because it hit max_segment_s, not because the speaker paused

    @property
    def end_sample(self) -> int:
        return self.start_sample + len(self.audio)


class VadSegmenter:
    def __init__(self, settings: VadSettings, model: SpeechProbModel | None = None) -> None:
        self._s = settings
        self._model = model if model is not None else SileroVad()
        ms = SAMPLE_RATE // 1000
        self._min_silence = settings.min_silence_ms * ms
        self._pad = settings.speech_pad_ms * ms
        self._min_speech = settings.min_speech_ms * ms
        self._max_segment = int(settings.max_segment_s * SAMPLE_RATE)

        self._leftover = np.zeros(0, dtype=np.float32)
        self._samples_seen = 0  # samples that went through the model
        self._preroll: deque[np.ndarray] = deque(maxlen=max(1, self._pad // WINDOW))
        self._in_speech = False
        self._windows: list[np.ndarray] = []
        self._segment_start = 0
        self._voiced = 0  # samples in the current segment the model is confident are speech
        self._silence = 0  # trailing silence in the current segment

    @property
    def in_speech(self) -> bool:
        return self._in_speech

    @property
    def samples_seen(self) -> int:
        return self._samples_seen

    @property
    def segment_start(self) -> int:
        return self._segment_start

    def current_audio(self) -> np.ndarray:
        """Audio of the phrase being spoken right now (empty when silent)."""
        if not self._windows:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(self._windows)

    def feed(self, audio: np.ndarray) -> list[SpeechSegment]:
        audio = np.concatenate([self._leftover, audio]) if len(self._leftover) else audio
        usable = len(audio) - len(audio) % WINDOW
        self._leftover = audio[usable:].copy()

        segments: list[SpeechSegment] = []
        for offset in range(0, usable, WINDOW):
            window = audio[offset : offset + WINDOW]
            prob = self._model(window)
            self._samples_seen += WINDOW
            segment = self._step(window, prob)
            if segment is not None:
                segments.append(segment)
        return segments

    def flush(self) -> list[SpeechSegment]:
        """End the current phrase, e.g. when the speaker leaves the call."""
        segment = self._close_segment(forced=False) if self._in_speech else None
        self._end_phrase()
        self._leftover = np.zeros(0, dtype=np.float32)
        self._model.reset()
        return [segment] if segment is not None else []

    def _step(self, window: np.ndarray, prob: float) -> SpeechSegment | None:
        if not self._in_speech:
            if prob >= self._s.threshold:
                self._in_speech = True
                self._windows = [*self._preroll, window]
                self._segment_start = self._samples_seen - WINDOW * len(self._windows)
                self._preroll.clear()
                self._voiced = WINDOW
                self._silence = 0
            else:
                self._preroll.append(window)
            return None

        self._windows.append(window)
        if prob >= self._s.threshold:
            self._voiced += WINDOW
            self._silence = 0
        elif prob < self._s.neg_threshold:
            self._silence += WINDOW

        if self._silence >= self._min_silence:
            segment = self._close_segment(forced=False)
            self._end_phrase()
            return segment
        if (len(self._windows) + 1) * WINDOW > self._max_segment:
            segment = self._close_segment(forced=True)
            # Speech continues: the next window starts a new segment right away.
            self._windows = []
            self._segment_start = self._samples_seen
            self._voiced = 0
            self._silence = 0
            return segment
        return None

    def _close_segment(self, forced: bool) -> SpeechSegment | None:
        if self._voiced < self._min_speech:
            return None
        audio = self.current_audio()
        trailing_cut = max(0, self._silence - self._pad)
        if trailing_cut:
            audio = audio[: len(audio) - trailing_cut]
        return SpeechSegment(audio=audio, start_sample=self._segment_start, forced=forced)

    def _end_phrase(self) -> None:
        self._in_speech = False
        self._windows = []
        self._voiced = 0
        self._silence = 0
        self._segment_start = self._samples_seen
        self._preroll.clear()
