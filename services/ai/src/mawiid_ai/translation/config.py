"""Translation settings. Override with MAWIID_MT_* environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from mawiid_ai.stt.config import MODELS_DIR

# MADLAD-400 sizes, by MAWIID_MT_MODEL. Same languages and tokenizer; 10b translates better
# (Darija too) but needs ~11 GB of GPU memory and is ~3x slower: a GPU host only.
MODELS = {"3b": "google/madlad400-3b-mt", "10b": "google/madlad400-10b-mt"}


def _env(name: str, default: str) -> str:
    return os.environ.get(f"MAWIID_MT_{name}", default)


def model_size() -> str:
    size = _env("MODEL", "3b")
    if size not in MODELS:
        raise ValueError(f"MAWIID_MT_MODEL: unknown model {size!r} (known: {', '.join(MODELS)})")
    return size


def model_dir(size: str) -> Path:
    """Where scripts/convert_translation_model.py writes the CTranslate2 conversion of ``size``."""
    return MODELS_DIR / f"madlad400-{size}-mt-ct2"


@dataclass(frozen=True, slots=True)
class MadladSettings:
    model_path: str = field(default_factory=lambda: _env("MODEL_PATH", str(model_dir(model_size()))))
    device: str = field(default_factory=lambda: _env("DEVICE", "auto"))  # auto | cpu | cuda
    compute_type: str = field(default_factory=lambda: _env("COMPUTE_TYPE", "default"))
    cpu_threads: int = field(default_factory=lambda: int(_env("CPU_THREADS", "0")))
    # Greedy decoding scored the same as beam 4 on FLEURS (COMET 0.857 vs 0.856) and is faster.
    beam_size: int = 1


def _default_engines() -> list[str]:
    # A CPU copy of the model as backup costs ~3 GB of RAM, so it is opt-in.
    return ["madlad", "madlad-cpu"] if _env("CPU_BACKUP", "0") == "1" else ["madlad"]


@dataclass(frozen=True, slots=True)
class TranslationSettings:
    madlad: MadladSettings = field(default_factory=MadladSettings)
    # Live translation while someone talks (the stable words of each partial). Newer partials replace
    # queued ones, so a slow machine sends fewer instead of falling behind. 0: listeners of other
    # languages see each phrase only once it is finished.
    partials: bool = field(default_factory=lambda: _env("PARTIALS", "1") == "1")
    cooldown_s: float = 60.0  # how long a failed engine is skipped before it is retried
    engines: list[str] = field(default_factory=_default_engines)  # tried in order
