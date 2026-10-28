"""Shared translation types. Every translation engine implements these."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from mawiid_ai.stt.base import ResultKind


@dataclass(frozen=True, slots=True)
class Subtitle:
    kind: ResultKind  # same as the transcript it came from: partial (may change) or final
    text: str
    language: str  # the listener's Mawiid language code, e.g. "ar-SA"
    source_language: str  # the speaker's language
    source_text: str
    start: float  # seconds since the speaker's stream started
    end: float
    engine: str  # translation engine, or "passthrough" when the listener speaks the speaker's language


class TranslationError(Exception):
    """Raised when no engine can produce a translation."""


class TranslationEngine(ABC):
    """A loaded translation model. Thread-safe: subtitles for every speaker go through one engine."""

    name: str

    @abstractmethod
    def supports(self, source: str, target: str) -> bool:
        """Whether this engine can translate between the given Mawiid language codes."""

    @abstractmethod
    def translate(self, text: str, source: str, targets: list[str]) -> list[str]:
        """Translate one text into several languages at once; one result per target, in order."""
