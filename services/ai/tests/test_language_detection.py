import logging
from types import SimpleNamespace

import numpy as np

from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind
from mawiid_ai.stt.config import AUTO_LANGUAGE, VadSettings, WhisperSettings
from mawiid_ai.stt.whisper_engine import _MIXED_PROMPT, WhisperEngine, WhisperStream

LONG = np.zeros(4 * SAMPLE_RATE, dtype=np.float32)
MEDIUM = np.zeros(2 * SAMPLE_RATE, dtype=np.float32)
SHORT = np.zeros(SAMPLE_RATE // 2, dtype=np.float32)


class ScriptedVad:
    def __call__(self, window: np.ndarray) -> float:
        return 0.0

    def reset(self) -> None:
        pass


class FakeEngine:
    name = "whisper"
    partials = True

    def __init__(self, *detected: str, texts: list[str] | None = None) -> None:
        self.settings = WhisperSettings()
        self.vad_settings = VadSettings()
        self.detected = list(detected)
        self.texts = texts
        self.detections = 0
        self.transcribed: list[str] = []

    def detect_language(self, audio):
        self.detections += 1
        return self.detected.pop(0)

    def transcribe(self, audio, language, partial=False):
        self.transcribed.append(language)
        return self.texts.pop(0) if self.texts else "text"


def stream(engine: FakeEngine, language: str = AUTO_LANGUAGE) -> WhisperStream:
    return WhisperStream(engine, language, 0.0, ScriptedVad())


def test_each_chunk_gets_its_own_detected_language():
    engine = FakeEngine("fr-FR", "en-US")
    s = stream(engine)

    first = s._final(LONG, 0)
    second = s._final(LONG, len(LONG))

    assert (first.language, second.language) == ("fr-FR", "en-US")
    assert engine.transcribed == ["fr-FR", "en-US"]
    assert first.kind is ResultKind.FINAL


def test_chunks_of_one_second_or_more_are_detected_and_shorter_ones_reuse_the_language():
    engine = FakeEngine("fr-FR", "en-US")
    s = stream(engine)

    s._final(LONG, 0)
    assert s._final(SHORT, len(LONG)).language == "fr-FR"
    assert engine.detections == 1
    assert s._final(np.zeros(SAMPLE_RATE, dtype=np.float32), 2 * len(LONG)).language == "en-US"


def test_the_first_chunk_is_detected_however_short_without_a_hint():
    assert stream(FakeEngine("ar-SA"))._final(SHORT, 0).language == "ar-SA"


def test_short_first_chunks_start_from_the_hint_without_detecting():
    engine = FakeEngine()
    s = stream(engine)
    s.hint_language("fr-FR")

    assert s._final(SHORT, 0).language == "fr-FR"
    assert engine.detections == 0


def test_detection_overrides_the_hint():
    s = stream(FakeEngine("en-US"))
    s.hint_language("fr-FR")

    assert s._final(LONG, 0).language == "en-US"


def test_the_hint_does_not_replace_a_language_already_heard():
    s = stream(FakeEngine("en-US"))
    s._final(LONG, 0)
    s.hint_language("fr-FR")

    assert s._final(SHORT, len(LONG)).language == "en-US"


def test_a_fixed_language_ignores_hints_and_never_detects():
    engine = FakeEngine()
    s = stream(engine, "fr-FR")
    s.hint_language("en-US")

    assert s._final(LONG, 0).language == "fr-FR"
    assert engine.detections == 0


def test_partials_wait_for_more_audio_then_detect_once_per_chunk():
    engine = FakeEngine("en-US")
    s = stream(engine)
    s.hint_language("fr-FR")
    heard = {"audio": MEDIUM}
    s._vad = SimpleNamespace(in_speech=True, segment_start=0, samples_seen=0, current_audio=lambda: heard["audio"])

    results = []
    for seen, audio in ((SAMPLE_RATE, MEDIUM), (2 * SAMPLE_RATE, LONG), (3 * SAMPLE_RATE, LONG)):
        heard["audio"] = audio
        s._vad.samples_seen = seen
        s._next_partial_at = 0.0
        s._last_partial_text = ""
        results.append(s._maybe_partial())

    assert [result.language for result in results] == ["fr-FR", "en-US", "en-US"]
    assert engine.detections == 1


def test_words_repeated_by_the_overlap_are_removed_from_the_next_final():
    engine = FakeEngine(texts=["je vais parler", "parler English now"])
    s = stream(engine, "fr-FR")

    s._final(LONG, 0)
    second = s._final(LONG, len(LONG) - SAMPLE_RATE // 2)

    assert second.text == "English now"


def test_chunks_without_shared_audio_keep_real_repetitions():
    engine = FakeEngine(texts=["oui", "oui"])
    s = stream(engine, "fr-FR")

    s._final(SHORT, 0)
    second = s._final(SHORT, 10 * SAMPLE_RATE)

    assert second.text == "oui"


def test_a_chunk_that_only_repeats_the_overlap_gives_no_result(caplog):
    engine = FakeEngine(texts=["bonjour tout le monde", "le monde"])
    s = stream(engine, "fr-FR")
    s._final(LONG, 0)

    with caplog.at_level(logging.INFO, logger="mawiid_ai.stt.whisper_engine"):
        assert s._final(SHORT, len(LONG) - SAMPLE_RATE // 4) is None

    assert "removed overlap words: le monde" in caplog.text


def whisper_with(model) -> WhisperEngine:
    engine = WhisperEngine.__new__(WhisperEngine)
    engine.name = "whisper"
    engine._lock = None
    engine._model = model
    engine.settings = WhisperSettings()
    return engine


def test_detection_keeps_only_french_english_and_arabic_and_takes_the_highest():
    # Spanish is what Whisper hears most, but it isn't supported: French wins among the rest.
    probabilities = [("es", 0.6), ("fr", 0.3), ("en", 0.05), ("ar", 0.05)]
    model = SimpleNamespace(detect_language=lambda audio: ("es", 0.6, probabilities))

    assert whisper_with(model).detect_language(LONG) == "fr-FR"


def test_transcription_settings_for_mixed_speech():
    calls = []

    def transcribe(audio, **options):
        calls.append(options)
        return [], None

    whisper_with(SimpleNamespace(transcribe=transcribe)).transcribe(LONG, "ar-SA")

    [options] = calls
    assert options["language"] == "ar"
    assert options["task"] == "transcribe"
    assert options["condition_on_previous_text"] is False
    assert options["initial_prompt"] == _MIXED_PROMPT


def test_repetitive_partials_are_dropped_but_finals_are_kept():
    # Finals have already been through Whisper's retries by the time they get here.
    looping = SimpleNamespace(text="1.1.1.1.1.1", compression_ratio=8.0)
    model = SimpleNamespace(transcribe=lambda audio, **options: ([looping], None))

    assert whisper_with(model).transcribe(LONG, "fr-FR", partial=True) == ""
    assert whisper_with(model).transcribe(LONG, "fr-FR") == "1.1.1.1.1.1"


def test_the_default_model_is_multilingual_large_v3(monkeypatch):
    monkeypatch.delenv("MAWIID_STT_WHISPER_MODEL", raising=False)
    assert WhisperSettings().model == "large-v3"
