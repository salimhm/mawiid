"""Text clean-up applied to every engine's output."""

from __future__ import annotations

from functools import cache

import opencc

from mawiid_ai.stt.config import LANGUAGES


@cache
def _converter(config: str) -> opencc.OpenCC:
    return opencc.OpenCC(config)


def normalize_script(text: str, language: str) -> str:
    """Force Chinese output into the script the speaker picked.

    zh-CN and zh-TW are the same spoken Mandarin; models emit either script, so we convert.
    """
    script = LANGUAGES[language].script if language in LANGUAGES else None
    if script == "simplified":
        return _converter("t2s").convert(text)
    if script == "traditional":
        return _converter("s2tw").convert(text)
    return text


def clean_text(text: str, language: str) -> str:
    return normalize_script(" ".join(text.split()), language)
