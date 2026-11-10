"""Language routes and tunable settings. Override settings with MAWIID_STT_* environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Language:
    model_code: str  # code the models expect ("fr", "zh", ...)
    script: str | None = None  # forced Chinese script: "simplified" or "traditional"


# Every language the code can handle, by Mawiid language code.
ALL_LANGUAGES: dict[str, Language] = {
    "en-US": Language("en"),
    "fr-FR": Language("fr"),
    "ar-SA": Language("ar"),
    "zh-CN": Language("zh", script="simplified"),
    "zh-TW": Language("zh", script="traditional"),
    # Whisper has no Darija token; Darija models are trained under "ar".
    "ar-MA": Language("ar"),
}

# The languages switched on, matching the "Speak:" dropdown in the apps. Chinese and Darija are
# off for now; add them back with MAWIID_LANGUAGES=en-US,fr-FR,ar-SA,zh-CN,zh-TW,ar-MA (and the
# commented-out entries in the frontend's MeetControls.jsx).
_DEFAULT_ENABLED = "en-US,fr-FR,ar-SA"


def _enabled_languages() -> dict[str, Language]:
    codes = [code.strip() for code in os.environ.get("MAWIID_LANGUAGES", _DEFAULT_ENABLED).split(",") if code.strip()]
    unknown = [code for code in codes if code not in ALL_LANGUAGES]
    if unknown:
        raise ValueError(f"MAWIID_LANGUAGES: unknown language {', '.join(unknown)} (known: {', '.join(ALL_LANGUAGES)})")
    return {code: ALL_LANGUAGES[code] for code in codes}


LANGUAGES: dict[str, Language] = _enabled_languages()

# Engines tried in order for each language. Engines that are not loaded
# (e.g. Voxtral on a machine without a GPU) are skipped.
ALL_ROUTES: dict[str, list[str]] = {
    "en-US": ["voxtral", "whisper"],
    "fr-FR": ["voxtral", "whisper"],
    "ar-SA": ["voxtral", "whisper"],
    "zh-CN": ["voxtral", "whisper"],
    "zh-TW": ["voxtral", "whisper"],
    # Stock Whisper only as a last resort: it hears Darija as Arabic and misses most dialect words.
    "ar-MA": ["whisper-darija", "whisper"],
}
DEFAULT_ROUTES: dict[str, list[str]] = {code: route for code, route in ALL_ROUTES.items() if code in LANGUAGES}

# Written by scripts/convert_darija_model.py; data/ is git-ignored.
DEFAULT_DARIJA_MODEL_PATH = Path(__file__).resolve().parents[3] / "data" / "models" / "whisper-darija-ct2"


def _env(name: str, default: str) -> str:
    return os.environ.get(f"MAWIID_STT_{name}", default)


@dataclass(frozen=True, slots=True)
class VadSettings:
    threshold: float = 0.6  # speech probability that starts speech (breathing and noise often reach 0.5)
    neg_threshold: float = 0.35  # probability below which a window counts as silence
    min_silence_ms: int = 500  # pause length that ends a phrase
    speech_pad_ms: int = 200  # audio kept before speech starts so first syllables aren't cut
    min_speech_ms: int = 400  # shorter blips are dropped (coughs, clicks, breaths); Whisper makes up text for them
    max_segment_s: float = 6.0  # non-stop speech is cut so it shows up without waiting for a pause


@dataclass(frozen=True, slots=True)
class WhisperSettings:
    model: str = field(default_factory=lambda: _env("WHISPER_MODEL", "small"))
    device: str = field(default_factory=lambda: _env("WHISPER_DEVICE", "auto"))  # auto | cpu | cuda
    compute_type: str = field(default_factory=lambda: _env("WHISPER_COMPUTE_TYPE", "default"))
    cpu_threads: int = field(default_factory=lambda: int(_env("WHISPER_CPU_THREADS", "0")))
    beam_size: int = 5  # finals: accuracy matters
    partial_beam_size: int = 1  # partials: speed matters
    partial_interval_s: float = field(default_factory=lambda: float(_env("PARTIAL_INTERVAL_S", "1.0")))
    partials: str = field(default_factory=lambda: _env("PARTIALS", "1"))  # 1 | 0
    # Partials use at most this share of the time, so a slow machine shows fewer instead of falling behind.
    partial_max_load: float = 0.5
    # Phrases Whisper thinks are probably not speech are dropped, however sure it is of the text:
    # its made-up "Thank you." / "I don't know." over silence are confident.
    max_no_speech_prob: float = 0.6
    min_avg_logprob: float = -1.0
    # The end of the speaker's previous phrase is given to Whisper as a prompt, so a phrase cut in
    # the middle of a sentence continues it (no false full stop) and names keep their spelling. 0: off.
    context_chars: int = field(default_factory=lambda: int(_env("CONTEXT_CHARS", "200")))
    # Each phrase's language is detected among the enabled ones (MAWIID_LANGUAGES), so a speaker who
    # switches language, or never picked the one they speak, is still transcribed right. What they
    # picked is only the first guess. 0: always use the picked language.
    detect_language: bool = field(default_factory=lambda: _env("DETECT_LANGUAGE", "1") == "1")
    detect_min_s: float = 1.0  # shorter phrases ("OK", "merci") keep the speaker's current language
    # How sure Whisper must be, among the enabled languages, before moving away from the current one.
    detect_switch_prob: float = 0.7


def _darija_settings() -> WhisperSettings:
    # Same tuning as the main Whisper engine, different weights.
    return WhisperSettings(model=_env("DARIJA_MODEL", str(DEFAULT_DARIJA_MODEL_PATH)))


@dataclass(frozen=True, slots=True)
class FailoverSettings:
    cooldown_s: float = 60.0  # how long a failed engine is skipped before it is retried
    # A call counts as a failure (engine overloaded) only when it is both long and slower than the
    # audio it covered: a 6 s final for a 15 s phrase still keeps up and must not demote a better model.
    slow_call_s: float = 3.0
    max_real_time_factor: float = 1.0
    max_replay_s: float = 30.0  # audio kept since the last final, replayed into the backup engine


@dataclass(frozen=True, slots=True)
class SttSettings:
    vad: VadSettings = field(default_factory=VadSettings)
    whisper: WhisperSettings = field(default_factory=WhisperSettings)
    darija: WhisperSettings = field(default_factory=_darija_settings)
    failover: FailoverSettings = field(default_factory=FailoverSettings)
    routes: dict[str, list[str]] = field(default_factory=lambda: {k: list(v) for k, v in DEFAULT_ROUTES.items()})
