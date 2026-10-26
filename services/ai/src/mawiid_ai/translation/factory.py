"""Loads the translation engines this machine can run and wires them into a translator."""

from __future__ import annotations

import logging
from dataclasses import replace

from mawiid_ai.translation.base import TranslationEngine
from mawiid_ai.translation.config import TranslationSettings
from mawiid_ai.translation.madlad_engine import MadladEngine
from mawiid_ai.translation.translator import SubtitleTranslator

log = logging.getLogger(__name__)


def load_engines(settings: TranslationSettings) -> dict[str, TranslationEngine]:
    engines: dict[str, TranslationEngine] = {}
    errors: list[str] = []
    for name in settings.engines:
        try:
            if name == "madlad":
                engines[name] = _load_madlad(settings)
            elif name == "madlad-cpu":
                if getattr(engines.get("madlad"), "device", None) == "cpu":
                    continue  # the primary already runs on the CPU
                engines[name] = MadladEngine(replace(settings.madlad, device="cpu", compute_type="default"), name)
            else:
                raise ValueError(f"unknown translation engine {name!r}")
        except Exception as exc:
            log.exception("translation engine %s failed to load", name)
            errors.append(f"{name}: {exc}")

    if not engines:
        raise RuntimeError(f"no translation engine could be loaded ({'; '.join(errors)})")
    return engines


def _load_madlad(settings: TranslationSettings) -> TranslationEngine:
    try:
        return MadladEngine(settings.madlad)
    except FileNotFoundError:
        raise
    except Exception:
        if settings.madlad.device != "auto":
            raise
        # e.g. the GPU is full: slow subtitles beat none.
        log.warning("madlad could not load on the GPU; falling back to the CPU", exc_info=True)
        return MadladEngine(replace(settings.madlad, device="cpu", compute_type="default"))


def build_translator(settings: TranslationSettings | None = None) -> SubtitleTranslator:
    settings = settings or TranslationSettings()
    return SubtitleTranslator(load_engines(settings), settings)
