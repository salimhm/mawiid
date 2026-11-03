"""Turns one speaker's transcript into a subtitle for every listener language in the room.

Each language is translated once, however many listeners picked it. zh-CN and zh-TW share
one Chinese translation, converted to each script, and listeners who speak the speaker's
language get the transcript itself. Engines are tried in order (config.TranslationSettings);
one that fails is skipped by every speaker for a cooldown, like the speech-to-text router.
"""

from __future__ import annotations

import time
from collections.abc import Iterable, Mapping

from mawiid_ai.stt.base import ResultKind, Transcript
from mawiid_ai.stt.config import LANGUAGES
from mawiid_ai.stt.router import CircuitBreaker, Clock
from mawiid_ai.translation.base import Subtitle, TranslationEngine, TranslationError
from mawiid_ai.translation.config import TranslationSettings
from mawiid_ai.translation.postprocess import clean_translation

PASSTHROUGH = "passthrough"


class SubtitleTranslator:
    def __init__(
        self,
        engines: Mapping[str, TranslationEngine],
        settings: TranslationSettings,
        clock: Clock = time.monotonic,
    ) -> None:
        self.engines = dict(engines)
        self.settings = settings
        self.order = [name for name in settings.engines if name in self.engines]
        self.breaker = CircuitBreaker(settings.cooldown_s, clock)

    def translate(self, transcript: Transcript, targets: Iterable[str]) -> list[Subtitle]:
        """Subtitles for the given listener languages (duplicates are fine), in their order."""
        targets = list(dict.fromkeys(targets))
        unknown = [lang for lang in (transcript.language, *targets) if lang not in LANGUAGES]
        if unknown:
            raise TranslationError(f"unsupported language: {', '.join(unknown)}")
        text = transcript.text.strip()
        if not text:
            return []

        spoken = LANGUAGES[transcript.language].model_code
        # Listeners grouped by the language the model writes; one translation per group.
        groups: dict[str, list[str]] = {}
        if transcript.kind is ResultKind.FINAL or self.settings.partials:
            for target in targets:
                code = LANGUAGES[target].model_code
                if code != spoken:
                    groups.setdefault(code, []).append(target)

        translated: dict[str, str] = {}
        engine = PASSTHROUGH
        if groups:
            representatives = [listeners[0] for listeners in groups.values()]
            outputs, engine = self._translate(text, transcript.language, representatives)
            for listeners, output in zip(groups.values(), outputs):
                translated.update(dict.fromkeys(listeners, output))

        subtitles = []
        for target in targets:
            if LANGUAGES[target].model_code == spoken:
                subtitles.append(_subtitle(transcript, target, text, PASSTHROUGH))
            elif target in translated:
                subtitles.append(_subtitle(transcript, target, translated[target], engine))
        return subtitles

    def _translate(self, text: str, source: str, targets: list[str]) -> tuple[list[str], str]:
        able = [name for name in self.order if all(self.engines[name].supports(source, t) for t in targets)]
        # Everything cooling down: try anyway rather than leave listeners without subtitles.
        healthy = [name for name in able if self.breaker.available(name)] or able
        for name in healthy:
            try:
                return self.engines[name].translate(text, source, targets), name
            except Exception as exc:  # any engine crash moves on to the next one
                self.breaker.record_failure(name, repr(exc))
        raise TranslationError(f"no translation engine could translate {source} -> {', '.join(targets)}")


def _subtitle(transcript: Transcript, language: str, text: str, engine: str) -> Subtitle:
    return Subtitle(
        kind=transcript.kind,
        text=clean_translation(text, language),
        language=language,
        source_language=transcript.language,
        source_text=transcript.text,
        start=transcript.start,
        end=transcript.end,
        engine=engine,
    )
