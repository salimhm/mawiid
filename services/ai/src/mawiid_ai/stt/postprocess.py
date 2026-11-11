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


def normalize_for_compare(text: str) -> str:
    """Lower-cased, without punctuation or extra spaces: for comparing two transcripts."""
    return " ".join(_PUNCTUATION.sub("", text.lower()).split())


# Fast speech is about 15-20 characters a second with spaces, in every enabled language. The
# fixed allowance covers short phrases, where the voice detector's cut is barely longer than the
# words ("D'accord, merci." in 0.6 s).
MAX_CHARS_PER_SECOND = 20.0
SHORT_PHRASE_ALLOWANCE_CHARS = 15
_MIN_PLAUSIBILITY_AUDIO_S = 0.2


def implausible_length(text: str, audio_seconds: float) -> bool:
    """True when the text is far longer than anyone could say in that much audio: Whisper made
    up a sentence. ``audio_seconds`` is the phrase as cut by the voice detector, before padding."""
    if audio_seconds <= _MIN_PLAUSIBILITY_AUDIO_S:
        return False
    return len(text) > SHORT_PHRASE_ALLOWANCE_CHARS + MAX_CHARS_PER_SECOND * audio_seconds


def is_hallucination(text: str) -> bool:
    """True for text Whisper typically makes up when nobody is speaking."""
    lowered = text.lower()
    if any(fragment in lowered for fragment in _STOCK_FRAGMENTS):
        return True
    if _STRETCHED.search(text):
        return True
    words = normalize_for_compare(text).split()
    if not words:
        return True
    if " ".join(words) in _STOCK_PHRASES:
        return True
    # One word over and over: "سر. سر. سر.", "you you you".
    return len(words) >= 3 and len(set(words)) == 1


def repeats_context(text: str, context: str) -> bool:
    """True when the text is just the end of the prompt again: Whisper echoing what it was
    given instead of transcribing. Without this, one made-up phrase keeps coming back."""
    said, before = normalize_for_compare(text), normalize_for_compare(context)
    return bool(said) and before.endswith(said)
