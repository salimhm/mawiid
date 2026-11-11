from mawiid_ai.stt.config import DEFAULT_ROUTES, LANGUAGES, FailoverSettings, _enabled_languages
from mawiid_ai.stt.router import SttRouter

from conftest import needs_languages
from test_router import FakeClock, FakeEngine


def test_every_route_is_a_known_language():
    assert set(DEFAULT_ROUTES) <= set(LANGUAGES)


def test_english_french_arabic_and_darija_are_on_by_default(monkeypatch):
    monkeypatch.delenv("MAWIID_LANGUAGES", raising=False)
    assert list(_enabled_languages()) == ["en-US", "fr-FR", "ar-SA", "ar-MA"]


@needs_languages("ar-MA")
def test_darija_goes_through_stock_whisper_so_the_language_is_still_detected():
    assert DEFAULT_ROUTES["ar-MA"] == ["whisper", "whisper-darija"]


@needs_languages("ar-MA")
def test_darija_model_only_serves_darija():
    clock = FakeClock()
    darija = FakeEngine("whisper-darija", clock, languages=["ar-MA"])
    whisper = FakeEngine("whisper", clock, languages=list(LANGUAGES))
    router = SttRouter({"whisper-darija": darija, "whisper": whisper}, DEFAULT_ROUTES, FailoverSettings(), clock=clock)

    assert router.chain_for("ar-MA") == ["whisper", "whisper-darija"]
    assert router.chain_for("ar-SA") == ["whisper"]


@needs_languages("ar-MA")
def test_darija_falls_back_to_stock_whisper_when_model_is_missing():
    clock = FakeClock()
    whisper = FakeEngine("whisper", clock, languages=list(LANGUAGES))
    router = SttRouter({"whisper": whisper}, DEFAULT_ROUTES, FailoverSettings(), clock=clock)
    assert router.open_stream("ar-MA").engine == "whisper"


@needs_languages("ar-MA")
def test_engine_report_lists_the_engines_per_language():
    from mawiid_ai.stt.factory import engine_report

    clock = FakeClock()
    darija = FakeEngine("whisper-darija", clock, languages=["ar-MA"])
    whisper = FakeEngine("whisper", clock, languages=list(LANGUAGES))
    router = SttRouter({"whisper-darija": darija, "whisper": whisper}, DEFAULT_ROUTES, FailoverSettings(), clock=clock)
    report = engine_report(router)
    assert report["ar-MA"] == ["whisper", "whisper-darija"]
    assert report["fr-FR"] == ["whisper"]


@needs_languages("ar-MA")
def test_without_darija_detection_darija_readers_go_straight_to_the_darija_model(monkeypatch):
    from mawiid_ai.stt import factory
    from mawiid_ai.stt.config import SttSettings

    clock = FakeClock()
    engines = {
        "whisper": FakeEngine("whisper", clock, languages=list(LANGUAGES)),
        "whisper-darija": FakeEngine("whisper-darija", clock, languages=["ar-MA"]),
    }
    monkeypatch.setattr(factory, "load_engines", lambda settings: engines)
    router = factory.build_router(SttSettings(detect_darija=False))
    assert router.chain_for("ar-MA") == ["whisper-darija", "whisper"]
