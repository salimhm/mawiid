"""Loads the engines this machine can run and wires them into a router."""

from __future__ import annotations

import logging
from pathlib import Path

from mawiid_ai.stt.base import SttEngine
from mawiid_ai.stt.config import LANGUAGES, SttSettings
from mawiid_ai.stt.router import SttRouter

log = logging.getLogger(__name__)


def load_engines(settings: SttSettings) -> dict[str, SttEngine]:
    engines: dict[str, SttEngine] = {}

    try:
        from mawiid_ai.stt.whisper_engine import WhisperEngine

        engines["whisper"] = WhisperEngine(settings.whisper, settings.vad)
    except Exception:
        log.exception("whisper engine failed to load")

    if "ar-MA" in LANGUAGES:  # don't load the Darija model while Darija is switched off
        _load_darija(settings, engines)
    if settings.detect_darija and "whisper" in engines and "whisper-darija" in engines:
        # Every Arabic phrase goes to the Darija model; its words tell Darija from Standard Arabic.
        engines["whisper"].dialect_engine = engines["whisper-darija"]
    if any(LANGUAGES[code].model_code == "ar" for code in LANGUAGES) and settings.whisper.model == "small":
        log.warning(
            "Arabic is on with the small Whisper model, which is weak in Arabic: set "
            "MAWIID_STT_WHISPER_MODEL=medium or large-v3 if this machine can run it"
        )

    # Voxtral Realtime needs a GPU; its engine is added once we test on GPU hardware.
    # Until then routes that list "voxtral" fall through to the next engine.

    if not engines:
        raise RuntimeError("no speech-to-text engine could be loaded")
    return engines


def _load_darija(settings: SttSettings, engines: dict[str, SttEngine]) -> None:
    if not Path(settings.darija.model).exists():
        log.error(
            "no darija model at %s: ar-MA falls back to stock Whisper and will be transcribed as "
            "Standard Arabic (inaccurate). Run: make ai-models-darija",
            settings.darija.model,
        )
        return
    try:
        from mawiid_ai.stt.whisper_engine import WhisperEngine

        engines["whisper-darija"] = WhisperEngine(
            settings.darija, settings.vad, name="whisper-darija", languages=["ar-MA"]
        )
    except Exception:
        log.exception("darija engine failed to load")


def engine_report(router: SttRouter) -> dict[str, list[str]]:
    """The loaded engines each enabled language is transcribed with, in preference order."""
    return {language: router.chain_for(language) for language in LANGUAGES}


def build_router(settings: SttSettings | None = None) -> SttRouter:
    settings = settings or SttSettings()
    engines = load_engines(settings)
    routes = settings.routes
    if getattr(engines.get("whisper"), "dialect_engine", None) is None and "ar-MA" in routes:
        # No detection: whoever is on ar-MA (reads Darija) goes straight to the Darija model.
        routes = {**routes, "ar-MA": ["whisper-darija", "whisper"]}
    router = SttRouter(engines, routes, settings.failover)
    dialect = getattr(router.engines.get("whisper"), "dialect_engine", None)
    for language, chain in engine_report(router).items():
        if chain:
            arabic = f" (Arabic phrases: {dialect.name})" if dialect is not None and LANGUAGES[language].model_code == "ar" else ""
            log.info("stt route %s: %s%s", language, ", ".join(chain), arabic)
        else:
            log.error("stt route %s: no engine loaded, this language gets no captions", language)
    return router
