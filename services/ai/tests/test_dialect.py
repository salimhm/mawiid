from mawiid_ai.stt import whisper_engine
from mawiid_ai.stt.config import ALL_LANGUAGES, VadSettings, WhisperSettings
from mawiid_ai.stt.dialect import ArabicVariant, darija_words
from mawiid_ai.stt.whisper_engine import WhisperStream

from conftest import needs_languages
from test_vad import ScriptedVad, audio


def test_darija_words_are_found_with_and_without_a_prefix():
    assert darija_words("الجسم ديالي يخلي الظهر ديالي مستقيم") == ["ديالي", "ديالي"]
    assert darija_words("وديال الدار فدابا") == ["وديال", "فدابا"]
    assert darija_words("شكرا بِزَّاف") == ["بزاف"]  # diacritics don't hide a word


def test_standard_arabic_has_no_darija_words():
    for text in [
        "تشكلت في المحيط الأطلسي اليوم عاشر عاصفة مسماة لموسم الأعاصير الأطلسية",
        "حيث عاود الديك الصياح بحال من الأحوال، وهذه هادئة",
        "إن الذي يريد أن يتعلم لا بد أن يبدأ من هنا",
    ]:
        assert darija_words(text) == [], text


def test_one_darija_word_moves_to_darija():
    variant = ArabicVariant()
    assert variant.update("السلام عليكم") == "ar-SA"
    assert variant.update("واش نتا مزيان") == "ar-MA"


def test_moving_back_to_standard_arabic_needs_several_long_phrases():
    variant = ArabicVariant("ar-MA")
    assert variant.update("نعم") == "ar-MA"  # short: says nothing
    long_phrase = "إن الذي يريد أن يتعلم لا بد أن يبدأ من هنا"
    assert variant.update(long_phrase) == "ar-MA"
    assert variant.update(long_phrase) == "ar-MA"
    assert variant.update(long_phrase) == "ar-SA"


def test_a_darija_word_resets_the_count():
    variant = ArabicVariant("ar-MA")
    long_phrase = "إن الذي يريد أن يتعلم لا بد أن يبدأ من هنا"
    variant.update(long_phrase)
    variant.update(long_phrase)
    variant.update("هادشي مزيان")
    variant.update(long_phrase)
    assert variant.update(long_phrase) == "ar-MA"


class FakeWhisper:
    """Stands in for WhisperEngine: detection always hears the scripted language."""

    partials = False

    def __init__(self, name: str, said: list[str], heard: str = "ar") -> None:
        self.name = name
        self.settings = WhisperSettings(detect_language=True, detect_min_s=0.5)
        self.vad_settings = VadSettings()
        self.said = said
        self.heard = heard
        self.calls: list[str] = []
        self.dialect_engine = None

    def supports(self, language):
        return True

    def language_probs(self, audio):
        return {self.heard: 0.95, "fr": 0.05}

    def transcribe(self, audio, language, partial=False, context=""):
        self.calls.append(language)
        return self.said[len(self.calls) - 1]


def speak(stream, phrases: int):
    speech = audio(*[part for _ in range(phrases) for part in (("speech", 2), ("silence", 1))])
    results = []
    for i in range(0, len(speech), 320):
        results += stream.push_audio(speech[i : i + 320])
    return results


ENABLED = ("en-US", "fr-FR", "ar-SA", "ar-MA")


@needs_languages("ar-MA")
def test_arabic_phrases_go_to_the_darija_model_and_its_words_pick_the_label(monkeypatch):
    monkeypatch.setattr(whisper_engine, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ENABLED})
    stock = FakeWhisper("whisper", [])
    stock.dialect_engine = FakeWhisper("whisper-darija", ["السلام عليكم", "واش نتا مزيان اليوم", "شكرا بزاف"])
    stream = WhisperStream(stock, "fr-FR", 0.0, ScriptedVad())

    results = speak(stream, 3)

    assert [r.language for r in results] == ["ar-SA", "ar-MA", "ar-MA"]
    assert all(r.engine == "whisper-darija" for r in results)
    assert stock.calls == []


@needs_languages("ar-MA")
def test_other_languages_stay_on_stock_whisper(monkeypatch):
    monkeypatch.setattr(whisper_engine, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ENABLED})
    stock = FakeWhisper("whisper", ["Bonjour à tous, merci"], heard="fr")
    stock.dialect_engine = FakeWhisper("whisper-darija", [])
    results = speak(WhisperStream(stock, "ar-MA", 0.0, ScriptedVad()), 1)
    assert [(r.language, r.engine) for r in results] == [("fr-FR", "whisper")]


@needs_languages("ar-MA")
def test_a_picked_spoken_language_is_kept_whatever_the_words(monkeypatch):
    monkeypatch.setattr(whisper_engine, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ENABLED})
    stock = FakeWhisper("whisper", [])
    stock.dialect_engine = FakeWhisper("whisper-darija", ["واش نتا مزيان اليوم"])
    results = speak(WhisperStream(stock, "ar-SA", 0.0, ScriptedVad(), detect=False), 1)
    assert [(r.language, r.engine) for r in results] == [("ar-SA", "whisper-darija")]


@needs_languages("ar-MA")
def test_without_the_darija_model_arabic_stays_as_detected(monkeypatch):
    monkeypatch.setattr(whisper_engine, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ENABLED})
    stock = FakeWhisper("whisper", ["واش نتا مزيان اليوم"])
    results = speak(WhisperStream(stock, "fr-FR", 0.0, ScriptedVad()), 1)
    assert [(r.language, r.engine) for r in results] == [("ar-SA", "whisper")]
