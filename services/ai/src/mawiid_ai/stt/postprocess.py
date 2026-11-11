"""Text clean-up applied to every engine's output."""

from __future__ import annotations

import re
from functools import cache

import opencc

from mawiid_ai.stt.config import ALL_LANGUAGES as LANGUAGES


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


# What Whisper writes for silence, breathing or noise: credit lines and sign-offs from the
# subtitled videos it was trained on. Compared after lower-casing and dropping punctuation.
_STOCK_PHRASES = {
    "you",
    "thank you",
    "thanks",
    "thanks for watching",
    "thank you for watching",
    "thank you very much",
    "bye",
    "merci",
    "merci davoir regardé cette vidéo",
    "شكرا",
    "شكرا لكم",
    "شكرا للمشاهدة",
}
# Fragments that only appear in those credit lines, wherever they are in the text.
_STOCK_FRAGMENTS = (
    "amara.org",
    "sous-titres réalisés par",
    "sous-titrage st",
    "sous-titrage société radio-canada",
    "subtitles by",
    "ترجمة نانسي قنقر",
    "اشتركوا في القناة",
)
_PUNCTUATION = re.compile(r"[^\w\s]")
_STRETCHED = re.compile(r"(\w)\1{5,}")  # "Sssssss", "hmmmmmm"


def _normalized(text: str) -> str:
    return " ".join(_PUNCTUATION.sub("", text.lower()).split())


def is_hallucination(text: str) -> bool:
    """True for text Whisper typically makes up when nobody is speaking."""
    lowered = text.lower()
    if any(fragment in lowered for fragment in _STOCK_FRAGMENTS):
        return True
    if _STRETCHED.search(text):
        return True
    words = _normalized(text).split()
    if not words:
        return True
    if " ".join(words) in _STOCK_PHRASES:
        return True
    # One word over and over: "سر. سر. سر.", "you you you".
    return len(words) >= 3 and len(set(words)) == 1


def repeats_context(text: str, context: str) -> bool:
    """True when the text is just the end of the prompt again: Whisper echoing what it was
    given instead of transcribing. Without this, one made-up phrase keeps coming back."""
    said, before = _normalized(text), _normalized(context)
    return bool(said) and before.endswith(said)
