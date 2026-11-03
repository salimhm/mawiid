"""Translation settings. Override with MAWIID_MT_* environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Written by scripts/convert_translation_model.py; data/ is git-ignored.
DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[3] / "data" / "models" / "madlad400-3b-mt-ct2"


def _env(name: str, default: str) -> str:
    return os.environ.get(f"MAWIID_MT_{name}", default)


@dataclass(frozen=True, slots=True)
class MadladSettings:
    model_path: str = field(default_factory=lambda: _env("MODEL_PATH", str(DEFAULT_MODEL_PATH)))
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
    # Partials change every second; translating them multiplies GPU load, so by default only
    # listeners who speak the speaker's language see them.
    partials: bool = field(default_factory=lambda: _env("PARTIALS", "0") == "1")
    cooldown_s: float = 60.0  # how long a failed engine is skipped before it is retried
    engines: list[str] = field(default_factory=_default_engines)  # tried in order
