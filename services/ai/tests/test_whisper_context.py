from mawiid_ai.stt.config import VadSettings, WhisperSettings
from mawiid_ai.stt.whisper_engine import WhisperStream, previous_text

from test_vad import ScriptedVad, audio


def test_previous_text_keeps_the_end_cut_at_a_word():
    assert previous_text("", "Bonjour à tous.", 200) == "Bonjour à tous."
    assert previous_text("Bonjour à tous.", "Je pense que", 200) == "Bonjour à tous. Je pense que"
    assert previous_text("Bonjour à tous.", "Je pense que", 15) == "Je pense que"
    assert previous_text("Bonjour", "à tous", 0) == ""


class RecordingEngine:
    """Stands in for WhisperEngine: records the context of every call."""

    name = "fake"
    partials = False

    def __init__(self) -> None:
        self.settings = WhisperSettings(context_chars=200, detect_language=False)
        self.vad_settings = VadSettings()
        self.contexts: list[str] = []

    def transcribe(self, audio, language, partial=False, context=""):
        self.contexts.append(context)
        return f"this is phrase number {len(self.contexts)}"


def test_each_phrase_is_transcribed_with_what_the_speaker_said_before():
    engine = RecordingEngine()
    stream = WhisperStream(engine, "fr-FR", 0.0, ScriptedVad())
    speech = audio(("speech", 1), ("silence", 1), ("speech", 1), ("silence", 1), ("speech", 1), ("silence", 1))

    for i in range(0, len(speech), 320):
        stream.push_audio(speech[i : i + 320])

    assert engine.contexts == ["", "this is phrase number 1", "this is phrase number 1 this is phrase number 2"]


class ShortEngine(RecordingEngine):
    def transcribe(self, audio, language, partial=False, context=""):
        self.contexts.append(context)
        return "Okay." if len(self.contexts) == 1 else "And then we went home."


def test_short_finals_are_not_used_as_a_prompt():
    engine = ShortEngine()
    stream = WhisperStream(engine, "en-US", 0.0, ScriptedVad())
    speech = audio(("speech", 1), ("silence", 1), ("speech", 1), ("silence", 1), ("speech", 1), ("silence", 1))

    for i in range(0, len(speech), 320):
        stream.push_audio(speech[i : i + 320])

    assert engine.contexts == ["", "", "And then we went home."]
