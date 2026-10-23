"""Loads the engines this machine can run and wires them into a router."""

from __future__ import annotations

import logging

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

    # Voxtral Realtime needs a GPU; its engine is added once we test on GPU hardware.
    # Until then routes that list "voxtral" fall through to the next engine.

    if not engines:
        raise RuntimeError("no speech-to-text engine could be loaded")
    return engines


def build_router(settings: SttSettings | None = None) -> SttRouter:
    settings = settings or SttSettings()
    return SttRouter(load_engines(settings), settings.routes, settings.failover)
