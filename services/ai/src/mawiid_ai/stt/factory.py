"""Loads the engines this machine can run and wires them into a router."""

from __future__ import annotations

import logging
from pathlib import Path

from mawiid_ai.stt.base import SttEngine
from mawiid_ai.stt.config import SttSettings
from mawiid_ai.stt.router import SttRouter

log = logging.getLogger(__name__)


def load_engines(settings: SttSettings) -> dict[str, SttEngine]:
    engines: dict[str, SttEngine] = {}

    try:
        from mawiid_ai.stt.whisper_engine import WhisperEngine

        engines["whisper"] = WhisperEngine(settings.whisper, settings.vad)
    except Exception:
        log.exception("whisper engine failed to load")

    if Path(settings.darija.model).exists():
        try:
            from mawiid_ai.stt.whisper_engine import WhisperEngine

            engines["whisper-darija"] = WhisperEngine(
                settings.darija, settings.vad, name="whisper-darija", languages=["ar-MA"]
            )
        except Exception:
            log.exception("darija engine failed to load")
    else:
        log.info("no darija model at %s (run scripts/convert_darija_model.py)", settings.darija.model)

    # Voxtral Realtime needs a GPU; its engine is added once we test on GPU hardware.
    # Until then routes that list "voxtral" fall through to the next engine.

    if not engines:
        raise RuntimeError("no speech-to-text engine could be loaded")
    return engines


def build_router(settings: SttSettings | None = None) -> SttRouter:
    settings = settings or SttSettings()
    return SttRouter(load_engines(settings), settings.routes, settings.failover)
