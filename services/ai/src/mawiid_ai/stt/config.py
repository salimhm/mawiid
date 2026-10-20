"""Language routes and tunable settings. Override settings with MAWIID_STT_* environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class Language:
    model_code: str  # code the models expect ("fr", "zh", ...)
    script: str | None = None  # forced Chinese script: "simplified" or "traditional"


# Mawiid language codes, matching the "Speak:" dropdown in the apps.
LANGUAGES: dict[str, Language] = {
    "en-US": Language("en"),
    "fr-FR": Language("fr"),
    "ar-SA": Language("ar"),
    "zh-CN": Language("zh", script="simplified"),
    "zh-TW": Language("zh", script="traditional"),
    # "ar-MA" (Darija) comes later with its own engine.
}

# Engines tried in order for each language. Engines that are not loaded
# (e.g. Voxtral on a machine without a GPU) are skipped.
DEFAULT_ROUTES: dict[str, list[str]] = {
    "en-US": ["voxtral", "whisper"],
    "fr-FR": ["voxtral", "whisper"],
    "ar-SA": ["voxtral", "whisper"],
    "zh-CN": ["voxtral", "whisper"],
    "zh-TW": ["voxtral", "whisper"],
}


def _env(name: str, default: str) -> str:
    return os.environ.get(f"MAWIID_STT_{name}", default)


@dataclass(frozen=True, slots=True)
class VadSettings:
    threshold: float = 0.5  # speech probability that starts speech
    neg_threshold: float = 0.35  # probability below which a window counts as silence
    min_silence_ms: int = 500  # pause length that ends a phrase
    speech_pad_ms: int = 200  # audio kept before speech starts so first syllables aren't cut
    min_speech_ms: int = 250  # shorter blips are dropped (coughs, clicks)
    max_segment_s: float = 15.0  # long monologues are cut so finals keep flowing


@dataclass(frozen=True, slots=True)
class WhisperSettings:
    model: str = field(default_factory=lambda: _env("WHISPER_MODEL", "small"))
    device: str = field(default_factory=lambda: _env("WHISPER_DEVICE", "auto"))  # auto | cpu | cuda
    compute_type: str = field(default_factory=lambda: _env("WHISPER_COMPUTE_TYPE", "default"))
    cpu_threads: int = field(default_factory=lambda: int(_env("WHISPER_CPU_THREADS", "0")))
    beam_size: int = 5  # finals: accuracy matters
    partial_beam_size: int = 1  # partials: speed matters
    partial_interval_s: float = field(default_factory=lambda: float(_env("PARTIAL_INTERVAL_S", "1.0")))
    # auto: on with a GPU, off on CPU (each partial costs a full Whisper pass; a CPU can't keep up).
    partials: str = field(default_factory=lambda: _env("PARTIALS", "auto"))  # auto | 1 | 0
    # Results Whisper is unsure about are dropped; this is where its "Thank you." hallucinations live.
    max_no_speech_prob: float = 0.6
    min_avg_logprob: float = -1.0


@dataclass(frozen=True, slots=True)
class FailoverSettings:
    cooldown_s: float = 60.0  # how long a failed engine is skipped before it is retried
    slow_call_s: float = 3.0  # a call slower than this counts as a failure (engine overloaded)
    max_replay_s: float = 30.0  # audio kept since the last final, replayed into the backup engine


@dataclass(frozen=True, slots=True)
class SttSettings:
    vad: VadSettings = field(default_factory=VadSettings)
    whisper: WhisperSettings = field(default_factory=WhisperSettings)
    failover: FailoverSettings = field(default_factory=FailoverSettings)
    routes: dict[str, list[str]] = field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_ROUTES.items()})
