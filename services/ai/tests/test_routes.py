from mawiid_ai.stt.config import DEFAULT_ROUTES, LANGUAGES, FailoverSettings, _enabled_languages
from mawiid_ai.stt.router import SttRouter

from conftest import needs_languages
from test_router import FakeClock, FakeEngine


def test_every_route_is_a_known_language():
    assert set(DEFAULT_ROUTES) <= set(LANGUAGES)


def test_only_arabic_english_and_french_are_on_by_default(monkeypatch):
    monkeypatch.delenv("MAWIID_LANGUAGES", raising=False)
    assert list(_enabled_languages()) == ["en-US", "fr-FR", "ar-SA"]


@needs_languages("ar-MA")
def test_darija_prefers_the_darija_model_then_stock_whisper():
    assert DEFAULT_ROUTES["ar-MA"] == ["whisper-darija", "whisper"]


@needs_languages("ar-MA")
def test_darija_model_only_serves_darija():
    clock = FakeClock()
    darija = FakeEngine("whisper-darija", clock, languages=["ar-MA"])
    whisper = FakeEngine("whisper", clock, languages=list(LANGUAGES))
    router = SttRouter({"whisper-darija": darija, "whisper": whisper}, DEFAULT_ROUTES, FailoverSettings(), clock=clock)

    assert router.chain_for("ar-MA") == ["whisper-darija", "whisper"]
    assert router.chain_for("ar-SA") == ["whisper"]


@needs_languages("ar-MA")
def test_darija_falls_back_to_stock_whisper_when_model_is_missing():
    clock = FakeClock()
    whisper = FakeEngine("whisper", clock, languages=list(LANGUAGES))
    router = SttRouter({"whisper": whisper}, DEFAULT_ROUTES, FailoverSettings(), clock=clock)
    assert router.open_stream("ar-MA").engine == "whisper"
