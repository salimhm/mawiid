from mawiid_ai.stt.config import ALL_LANGUAGES, VadSettings, WhisperSettings
from mawiid_ai.stt import whisper_engine
from mawiid_ai.stt.whisper_engine import WhisperStream, pick_language

from test_vad import ScriptedVad, audio

ENABLED = ["en-US", "fr-FR", "ar-SA"]


def test_the_most_likely_enabled_language_wins_when_whisper_is_sure():
    assert pick_language({"ar": 0.9, "fr": 0.05, "en": 0.05}, "fr-FR", ENABLED, 0.7) == "ar-SA"
    assert pick_language({"en": 0.8, "fr": 0.2}, "fr-FR", ENABLED, 0.7) == "en-US"


def test_only_enabled_languages_count():
    # Whisper hears Spanish, but among the enabled languages it is clearly French.
    assert pick_language({"es": 0.6, "fr": 0.35, "en": 0.05}, "en-US", ENABLED, 0.7) == "fr-FR"


def test_an_unsure_phrase_keeps_the_current_language():
    assert pick_language({"fr": 0.45, "en": 0.4, "ar": 0.15}, "en-US", ENABLED, 0.7) == "en-US"
    assert pick_language({}, "ar-SA", ENABLED, 0.7) == "ar-SA"
    assert pick_language({"fr": 0.5, "en": 0.5}, "en-US", ENABLED, 0.7) == "en-US"


def test_languages_sharing_a_model_code_keep_the_speakers_pick():
    languages = ["fr-FR", "ar-SA", "ar-MA"]
    assert pick_language({"ar": 0.95, "fr": 0.05}, "ar-MA", languages, 0.7) == "ar-MA"
    assert pick_language({"ar": 0.95, "fr": 0.05}, "fr-FR", languages, 0.7) == "ar-SA"


def test_detection_never_switches_between_arabic_variants():
    languages = ["en-US", "fr-FR", "ar-SA", "ar-MA"]
    assert pick_language({"ar": 0.99}, "ar-SA", languages, 0.7) == "ar-SA"
    assert pick_language({"ar": 0.99}, "ar-MA", languages, 0.7) == "ar-MA"


class DetectingEngine:
    """Stands in for WhisperEngine: each phrase "is" in the next scripted language."""

    name = "fake"
    partials = False

    def __init__(self, spoken: list[str]) -> None:
        self.settings = WhisperSettings(context_chars=200, detect_language=True, detect_min_s=0.5)
        self.vad_settings = VadSettings()
        self.spoken = spoken
        self.calls: list[tuple[str, str]] = []

    def supports(self, language):
        return language in ENABLED

    def language_probs(self, audio):
        return {self.spoken[len(self.calls)]: 0.9, "es": 0.1}

    def transcribe(self, audio, language, partial=False, context=""):
        self.calls.append((language, context))
        return f"this is phrase number {len(self.calls)}"


def speak(stream, *parts):
    speech = audio(*parts)
    results = []
    for i in range(0, len(speech), 320):
        results += stream.push_audio(speech[i : i + 320])
    return results


def test_each_phrase_is_transcribed_in_the_language_detected(monkeypatch):
    monkeypatch.setattr(whisper_engine, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ENABLED})
    engine = DetectingEngine(["fr", "ar", "ar"])
    stream = WhisperStream(engine, "en-US", 0.0, ScriptedVad())

    results = speak(stream, ("speech", 1), ("silence", 1), ("speech", 1), ("silence", 1), ("speech", 1), ("silence", 1))

    assert [r.language for r in results] == ["fr-FR", "ar-SA", "ar-SA"]
    # The French context is not prompted to the first Arabic phrase, and Arabic gets no prompt at all.
    assert engine.calls == [("fr-FR", ""), ("ar-SA", ""), ("ar-SA", "")]
    assert stream.language == "ar-SA"


def test_short_phrases_keep_the_current_language(monkeypatch):
    monkeypatch.setattr(whisper_engine, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ENABLED})
    engine = DetectingEngine(["ar"])
    engine.settings = WhisperSettings(detect_language=True, detect_min_s=1.5)
    stream = WhisperStream(engine, "fr-FR", 0.0, ScriptedVad())

    results = speak(stream, ("speech", 0.5), ("silence", 1))  # under 1.5 s even with the padding

    assert [r.language for r in results] == ["fr-FR"]


def test_detection_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(whisper_engine, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ENABLED})
    engine = DetectingEngine(["ar"])
    engine.settings = WhisperSettings(detect_language=False)
    stream = WhisperStream(engine, "fr-FR", 0.0, ScriptedVad())

    assert [r.language for r in speak(stream, ("speech", 1), ("silence", 1))] == ["fr-FR"]


def test_a_stream_opened_without_detection_keeps_its_language(monkeypatch):
    monkeypatch.setattr(whisper_engine, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ENABLED})
    engine = DetectingEngine(["ar"])
    stream = WhisperStream(engine, "fr-FR", 0.0, ScriptedVad(), detect=False)

    assert [r.language for r in speak(stream, ("speech", 1), ("silence", 1))] == ["fr-FR"]
