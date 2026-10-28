"""Clean-up applied to every subtitle before it is shown."""

from __future__ import annotations

import html
import re

from mawiid_ai.stt.config import LANGUAGES
from mawiid_ai.stt.postprocess import normalize_script

# MADLAD learned Moses-escaped text: "n &apos; a" for "n'a".
_SPACED_APOSTROPHE = re.compile(r"\s*&apos;\s*")
# ASCII punctuation right after a Chinese character ("后," but not "1,000").
_CHINESE_THEN_PUNCTUATION = re.compile(r"(?<=[㐀-䶿一-鿿])[,?!:;]")
_FULL_WIDTH = str.maketrans({",": "，", "?": "？", "!": "！", ":": "：", ";": "；"})


def clean_translation(text: str, language: str) -> str:
    text = html.unescape(_SPACED_APOSTROPHE.sub("'", text))
    text = " ".join(text.split())
    if language in LANGUAGES and LANGUAGES[language].model_code == "zh":
        text = _CHINESE_THEN_PUNCTUATION.sub(lambda m: m.group().translate(_FULL_WIDTH), text)
    return normalize_script(text, language)
