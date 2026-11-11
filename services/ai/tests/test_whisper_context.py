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


def _speak(stream, phrases: int) -> None:
    speech = audio(*[part for _ in range(phrases) for part in (("speech", 1), ("silence", 1))])
    for i in range(0, len(speech), 320):
        stream.push_audio(speech[i : i + 320])


def test_arabic_streams_do_not_prompt_with_previous_text():
    for language in ("ar-SA", "ar-MA"):
        engine = RecordingEngine()
        _speak(WhisperStream(engine, language, 0.0, ScriptedVad()), 3)
        assert engine.contexts == ["", "", ""], language


def test_french_streams_keep_the_prompt():
    engine = RecordingEngine()
    _speak(WhisperStream(engine, "fr-FR", 0.0, ScriptedVad()), 2)
    assert engine.contexts == ["", "this is phrase number 1"]


class RepeatingEngine(RecordingEngine):
    def __init__(self, text: str) -> None:
        super().__init__()
        self.text = text

    def transcribe(self, audio, language, partial=False, context=""):
        self.contexts.append(context)
        return self.text


def test_identical_long_final_twice_is_dropped():
    engine = RepeatingEngine("Merci beaucoup pour votre attention.")
    finals = []
    stream = WhisperStream(engine, "fr-FR", 0.0, ScriptedVad())
    speech = audio(("speech", 2), ("silence", 1), ("speech", 2), ("silence", 1))
    for i in range(0, len(speech), 320):
        finals += stream.push_audio(speech[i : i + 320])
    assert [r.text for r in finals] == ["Merci beaucoup pour votre attention."]


def test_short_repeats_are_kept():
    engine = RepeatingEngine("Oui.")
    finals = []
    stream = WhisperStream(engine, "fr-FR", 0.0, ScriptedVad())
    speech = audio(("speech", 1), ("silence", 1), ("speech", 1), ("silence", 1))
    for i in range(0, len(speech), 320):
        finals += stream.push_audio(speech[i : i + 320])
    assert [r.text for r in finals] == ["Oui.", "Oui."]


def test_a_paragraph_over_one_second_is_dropped():
    engine = RepeatingEngine("و " * 100)
    finals = []
    stream = WhisperStream(engine, "ar-SA", 0.0, ScriptedVad())
    speech = audio(("speech", 1), ("silence", 1))
    for i in range(0, len(speech), 320):
        finals += stream.push_audio(speech[i : i + 320])
    assert finals == []


class FakeSegment:
    def __init__(self, text: str, avg_logprob: float) -> None:
        self.text = text
        self.avg_logprob = avg_logprob
        self.no_speech_prob = 0.1
        self.compression_ratio = 1.5


class FakeModel:
    def transcribe(self, audio, **kwargs):
        return [FakeSegment("جملة واضحة", -0.3), FakeSegment(" جملة مختلقة", -1.4)], None


def _engine_with_fake_model():
    from mawiid_ai.stt.whisper_engine import WhisperEngine

    engine = object.__new__(WhisperEngine)  # skip loading real weights
    engine.name = "fake"
    engine.settings = WhisperSettings()
    engine._model = FakeModel()
    engine._lock = None
    return engine


def test_arabic_drops_segments_whisper_could_not_decode_confidently():
    assert _engine_with_fake_model().transcribe(audio(("speech", 1)), "ar-SA") == "جملة واضحة"


def test_other_languages_keep_low_confidence_segments():
    assert _engine_with_fake_model().transcribe(audio(("speech", 1)), "fr-FR") == "جملة واضحة جملة مختلقة"
