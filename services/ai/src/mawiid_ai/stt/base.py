"""Shared speech-to-text types. Every engine (Whisper, Voxtral, Darija) implements these."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import StrEnum

import numpy as np

# All engines receive 16 kHz mono audio. LiveKit can deliver this directly.
SAMPLE_RATE = 16_000


class ResultKind(StrEnum):
    PARTIAL = "partial"  # fast guess while the person is still talking; may change
    FINAL = "final"  # stable text for a finished phrase; sent once


@dataclass(frozen=True, slots=True)
class Transcript:
    kind: ResultKind
    text: str
    language: str  # Mawiid language code, e.g. "fr-FR"
    start: float  # seconds since the stream started
    end: float
    engine: str  # which engine produced it, useful for monitoring fallbacks


class SttError(Exception):
    """Raised when an engine cannot produce a result."""


class SttStream(ABC):
    """One speaker's live audio stream. Not thread-safe: feed it from one task."""

    @abstractmethod
    def push_audio(self, audio: np.ndarray | bytes) -> list[Transcript]:
        """Feed audio (int16 PCM bytes, int16 array or float32 array) and return any new results."""

    @abstractmethod
    def flush(self) -> list[Transcript]:
        """Finalize whatever speech is still buffered, e.g. when the speaker leaves."""

    def close(self) -> None:  # noqa: B027 - optional hook
        """Release resources held by the stream."""


class SttEngine(ABC):
    """A loaded model that can open one stream per speaker."""

    name: str

    @abstractmethod
    def supports(self, language: str) -> bool:
        """Whether this engine can transcribe the given Mawiid language code."""

    @abstractmethod
    def open_stream(self, language: str, time_offset: float = 0.0) -> SttStream:
        """Start a stream. ``time_offset`` shifts result timestamps (used when taking over from another engine)."""


def to_float32(audio: np.ndarray | bytes) -> np.ndarray:
    """Convert int16 PCM (bytes or array) or float audio to a float32 array in [-1, 1]."""
    if isinstance(audio, (bytes, bytearray, memoryview)):
        audio = np.frombuffer(audio, dtype=np.int16)
    if audio.dtype == np.int16:
        return audio.astype(np.float32) / 32768.0
    return audio.astype(np.float32, copy=False)
