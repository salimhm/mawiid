from dataclasses import dataclass

import pytest

from mawiid_ai.stt.base import ResultKind, Transcript
from mawiid_ai.translation.base import TranslationEngine, TranslationError
from mawiid_ai.translation.config import TranslationSettings
from mawiid_ai.translation.translator import SubtitleTranslator


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


@dataclass
class Call:
    text: str
    source: str
    targets: list[str]


class FakeEngine(TranslationEngine):
    """Returns '<target>text' (or a fixed reply per target) and records every call."""

    def __init__(self, name: str, replies: dict[str, str] | None = None, languages: set[str] | None = None) -> None:
        self.name = name
        self.replies = replies or {}
        self.languages = languages
        self.crash = False
        self.calls: list[Call] = []

    def supports(self, source: str, target: str) -> bool:
        return self.languages is None or {source, target} <= self.languages

    def translate(self, text: str, source: str, targets: list[str]) -> list[str]:
        self.calls.append(Call(text, source, list(targets)))
        if self.crash:
            raise RuntimeError(f"{self.name} crashed")
        return [self.replies.get(t, f"<{t}>{text}") for t in targets]


def transcript(text: str, language: str, kind: ResultKind = ResultKind.FINAL) -> Transcript:
    return Transcript(kind=kind, text=text, language=language, start=1.5, end=3.25, engine="whisper")


def make(*engines: FakeEngine, partials: bool = False, clock: FakeClock | None = None) -> SubtitleTranslator:
    settings = TranslationSettings(partials=partials, cooldown_s=60.0, engines=[e.name for e in engines])
    return SubtitleTranslator({e.name: e for e in engines}, settings, clock=clock or FakeClock())


def by_language(subtitles):
    return {s.language: s for s in subtitles}


def test_each_listener_language_gets_one_subtitle_from_one_engine_call():
    engine = FakeEngine("madlad")
    subs = by_language(make(engine).translate(transcript("Bonjour", "fr-FR"), ["en-US", "ar-SA", "fr-FR"]))

    assert {k: s.text for k, s in subs.items()} == {"en-US": "<en-US>Bonjour", "ar-SA": "<ar-SA>Bonjour", "fr-FR": "Bonjour"}
    assert len(engine.calls) == 1
    assert sorted(engine.calls[0].targets) == ["ar-SA", "en-US"]
    assert subs["fr-FR"].engine == "passthrough"
    assert subs["en-US"].engine == "madlad"


def test_subtitles_keep_the_transcript_timing_kind_and_source():
    [sub] = make(FakeEngine("madlad")).translate(transcript("Bonjour", "fr-FR"), ["en-US"])
    assert (sub.kind, sub.start, sub.end) == (ResultKind.FINAL, 1.5, 3.25)
    assert (sub.source_language, sub.source_text) == ("fr-FR", "Bonjour")


def test_duplicate_listener_languages_are_translated_once():
    engine = FakeEngine("madlad")
    subs = make(engine).translate(transcript("Bonjour", "fr-FR"), ["en-US", "en-US", "en-US"])
    assert [s.language for s in subs] == ["en-US"]
    assert engine.calls[0].targets == ["en-US"]


def test_simplified_and_traditional_listeners_share_one_chinese_translation():
    engine = FakeEngine("madlad", replies={"zh-CN": "这是简体", "zh-TW": "这是简体"})
    subs = by_language(make(engine).translate(transcript("This is simplified", "en-US"), ["zh-CN", "zh-TW"]))

    assert len(engine.calls) == 1 and len(engine.calls[0].targets) == 1
    assert subs["zh-CN"].text == "这是简体"
    assert subs["zh-TW"].text == "這是簡體"


def test_same_spoken_language_is_only_converted_to_the_listeners_script():
    engine = FakeEngine("madlad")
    [sub] = make(engine).translate(transcript("这是简体", "zh-CN"), ["zh-TW"])
    assert sub.text == "這是簡體"
    assert engine.calls == []


def test_partials_only_reach_same_language_listeners_by_default():
    engine = FakeEngine("madlad")
    subs = make(engine).translate(transcript("Bonjour", "fr-FR", ResultKind.PARTIAL), ["en-US", "fr-FR"])
    assert [(s.language, s.kind) for s in subs] == [("fr-FR", ResultKind.PARTIAL)]
    assert engine.calls == []


def test_partials_are_translated_when_enabled():
    engine = FakeEngine("madlad")
    [sub] = make(engine, partials=True).translate(transcript("Bonjour", "fr-FR", ResultKind.PARTIAL), ["en-US"])
    assert (sub.text, sub.kind) == ("<en-US>Bonjour", ResultKind.PARTIAL)


def test_engine_output_is_cleaned_for_display():
    engine = FakeEngine("madlad", replies={"fr-FR": "Il n &apos; a pas"})
    [sub] = make(engine).translate(transcript("He did not", "en-US"), ["fr-FR"])
    assert sub.text == "Il n'a pas"


def test_empty_text_produces_no_subtitles():
    engine = FakeEngine("madlad")
    assert make(engine).translate(transcript("   ", "fr-FR"), ["en-US", "fr-FR"]) == []
    assert engine.calls == []


def test_unknown_listener_language_is_rejected():
    with pytest.raises(TranslationError):
        make(FakeEngine("madlad")).translate(transcript("Bonjour", "fr-FR"), ["xx-XX"])


def test_crashed_engine_falls_back_to_the_next_one():
    primary, backup = FakeEngine("madlad"), FakeEngine("madlad-cpu")
    primary.crash = True
    [sub] = make(primary, backup).translate(transcript("Bonjour", "fr-FR"), ["en-US"])
    assert (sub.text, sub.engine) == ("<en-US>Bonjour", "madlad-cpu")


def test_failed_engine_is_skipped_until_its_cooldown_ends():
    clock = FakeClock()
    primary, backup = FakeEngine("madlad"), FakeEngine("madlad-cpu")
    translator = make(primary, backup, clock=clock)
    primary.crash = True
    translator.translate(transcript("Bonjour", "fr-FR"), ["en-US"])

    primary.crash = False
    translator.translate(transcript("Salut", "fr-FR"), ["en-US"])
    assert [c.text for c in primary.calls] == ["Bonjour"]

    clock.now += 61
    [sub] = translator.translate(transcript("Coucou", "fr-FR"), ["en-US"])
    assert sub.engine == "madlad"


def test_engine_without_the_language_pair_is_skipped():
    narrow, wide = FakeEngine("opus", languages={"en-US", "fr-FR"}), FakeEngine("madlad")
    [sub] = make(narrow, wide).translate(transcript("Bonjour", "fr-FR"), ["ar-SA"])
    assert sub.engine == "madlad"
    assert narrow.calls == []


def test_all_engines_failing_raises_translation_error():
    primary, backup = FakeEngine("madlad"), FakeEngine("madlad-cpu")
    primary.crash = backup.crash = True
    with pytest.raises(TranslationError):
        make(primary, backup).translate(transcript("Bonjour", "fr-FR"), ["en-US"])


def test_engines_are_retried_when_all_are_cooling_down():
    primary, backup = FakeEngine("madlad"), FakeEngine("madlad-cpu")
    translator = make(primary, backup)
    primary.crash = backup.crash = True
    with pytest.raises(TranslationError):
        translator.translate(transcript("Bonjour", "fr-FR"), ["en-US"])

    primary.crash = backup.crash = False
    [sub] = translator.translate(transcript("Salut", "fr-FR"), ["en-US"])  # still within the cooldown
    assert sub.text == "<en-US>Salut"
