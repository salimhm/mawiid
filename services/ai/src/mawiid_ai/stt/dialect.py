"""Tells Darija (ar-MA) from Standard Arabic (ar-SA) by the words that were said.

Whisper's language detection reports one "ar" for both, so the audio can't tell them apart.
The text can: Darija has everyday words Standard Arabic never uses (ديال, واش, بزاف, دابا...).
Every Arabic phrase is transcribed by the Darija model, which also writes Standard Arabic,
and the words decide which language the phrase is labelled with.
"""

from __future__ import annotations

import re

# Words that only Darija uses. Left out on purpose: words Standard Arabic also has, even
# rarely or with another meaning: لي "for me", غير, باش, فين, ديك "rooster", حيث "where",
# عاود "resumed", بحال "in a state", هادي "calm".
DARIJA_WORDS = frozenset(
    {
        # possession: "of", "my", "your"...
        "ديال", "ديالي", "ديالك", "ديالو", "ديالها", "ديالنا", "ديالكم", "ديالهم",
        # time, quantity, manner
        "دابا", "بزاف", "شوية", "شويا", "ديما", "دغيا", "مزيان", "مزيانة", "والو",
        "كيفاش", "علاش", "شنو", "اشنو", "آشنو", "شحال", "فوقاش", "منين", "واش", "ياك",
        # demonstratives and pronouns
        "هادشي", "داكشي", "هادو", "هاديك", "هاداك", "داك", "هاد",
        "نتا", "نتي", "نتوما", "حنا", "هوما",
        # "there is", "going to", "want", "must"
        "كاين", "كاينة", "كاينين", "كاينا", "غادي", "غادية", "غاديين", "غانمشي",
        "بغيت", "بغا", "بغات", "بغينا", "بغيتي", "خاصني", "خاصك", "خاصو", "خاصنا", "خصني",
        # "is" particles, "OK", "enough"
        "راه", "راني", "راك", "راها", "راهم", "راحنا", "واخا", "صافي", "زعما",
        "ماشي", "حيت", "بلاصة", "بلاصتي", "شي",
    }
)
# Arabic letters with the diacritics and tatweel removed, so spellings match the list.
_DIACRITICS = re.compile(r"[ً-ْٰـ]")
_WORD = re.compile(r"[ء-ي]+")


def _is_darija(word: str) -> bool:
    # "and" and "so" are written onto the next word: وديال, فدابا.
    return word in DARIJA_WORDS or (len(word) > 2 and word[0] in "وف" and word[1:] in DARIJA_WORDS)


def darija_words(text: str) -> list[str]:
    """The Darija-only words in a transcript."""
    return [word for word in _WORD.findall(_DIACRITICS.sub("", text)) if _is_darija(word)]


class ArabicVariant:
    """Which Arabic someone speaks, from what they said so far.

    One Darija word is enough to move to Darija: Standard Arabic doesn't use them. Moving
    back needs several long phrases in a row without any, because plenty of Darija phrases
    ("نعم", "الله يحفظك") have none either.
    """

    def __init__(self, start: str = "ar-SA", back_after: int = 3, long_words: int = 6) -> None:
        self.current = start
        self._back_after = back_after
        self._long_words = long_words
        self._plain_in_a_row = 0

    def update(self, text: str) -> str:
        """The variant after hearing ``text``."""
        if darija_words(text):
            self.current = "ar-MA"
            self._plain_in_a_row = 0
        elif len(_WORD.findall(text)) >= self._long_words:
            self._plain_in_a_row += 1
            if self._plain_in_a_row >= self._back_after:
                self.current = "ar-SA"
        return self.current
