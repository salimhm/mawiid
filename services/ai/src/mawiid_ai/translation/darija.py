"""Darija text made easier to translate, before it goes to the translation model.

MADLAD reads Darija as broken Standard Arabic: words such as دابا, بزاف, كاين or خاصني are
guessed at or dropped, and a long unpunctuated run loses whole clauses. So, for Darija
speakers only, the text sent to the model is:

1. tidied: diacritics, tatweel and stretched letters (بزااااف) removed;
2. rewritten word by word into Standard Arabic, for words with a single meaning (دابا -> الآن);
   ambiguous ones (شي, غير, لي, منين) are left as they are;
3. cut into sentences at connectors (لكن, لأن, ثم...) when a run is long and has no full stop,
   since MADLAD translates sentence by sentence.

Listeners who read Darija or Arabic still get the original transcript; only the model's input changes.
"""

from __future__ import annotations

import re

DARIJA = "ar-MA"

_DIACRITICS = re.compile(r"[ً-ْٰـ]")  # harakat, superscript alef, tatweel
_STRETCHED = re.compile(r"([ء-ي])\1{2,}")  # three or more of the same letter: بزااااف
_WORD = re.compile(r"[ء-ي]+")
_PREFIXES = "وف"  # "and" and "so", written onto the next word: ودابا, فغادي
_KEY = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه"})

# Darija -> Standard Arabic. A value ending in "+" is written onto the next word (ديال الدار ->
# الخاص بالدار). An empty value drops the word (راه only adds emphasis).
_WORDS = {
    # possession
    "ديال": "الخاص ب+",
    "ديالي": "الخاص بي",
    "ديالك": "الخاص بك",
    "ديالو": "الخاص به",
    "ديالها": "الخاص بها",
    "ديالنا": "الخاص بنا",
    "ديالكم": "الخاص بكم",
    "ديالهم": "الخاص بهم",
    # time, quantity, manner
    "دابا": "الآن",
    "بزاف": "كثيرا",
    "شوية": "قليلا",
    "شويا": "قليلا",
    "ديما": "دائما",
    "دغيا": "بسرعة",
    "مزيان": "جيد",
    "مزيانة": "جيدة",
    "والو": "لا شيء",
    "بحال": "مثل",
    # questions
    "واش": "هل",
    "كيفاش": "كيف",
    "علاش": "لماذا",
    "شنو": "ماذا",
    "اشنو": "ماذا",
    "شحال": "كم",
    "فوقاش": "متى",
    "فين": "أين",
    # demonstratives and pronouns
    "هاد": "هذا",
    "هادشي": "هذا",
    "داكشي": "ذلك",
    "هادو": "هؤلاء",
    "هاديك": "تلك",
    "هاداك": "ذلك",
    "داك": "ذلك",
    "نتا": "أنت",
    "نتي": "أنت",
    "نتوما": "أنتم",
    "حنا": "نحن",
    "هوما": "هم",
    # "there is", "want", "must"
    "كاين": "يوجد",
    "كاينة": "توجد",
    "كاينا": "توجد",
    "كاينين": "يوجد",
    "ماكاينش": "لا يوجد",
    "مكاينش": "لا يوجد",
    "بغيت": "أريد",
    "بغا": "يريد",
    "بغات": "تريد",
    "بغينا": "نريد",
    "بغيتي": "تريد",
    "مابغيتش": "لا أريد",
    "خاصني": "يجب علي",
    "خصني": "يجب علي",
    "خاصك": "يجب عليك",
    "خاصو": "يجب عليه",
    "خاصها": "يجب عليها",
    "خاصنا": "يجب علينا",
    "غانمشي": "سأذهب",
    # "is" particles: راني تعبان -> أنا تعبان
    "راه": "",
    "راني": "أنا",
    "راك": "أنت",
    "راها": "هي",
    "راهم": "هم",
    "راحنا": "نحن",
    # linking words
    "حيت": "لأن",
    "باش": "لكي",
    "ماشي": "ليس",
    "واخا": "حسنا",
    "صافي": "حسنا",
    "زعما": "يعني",
    "ولا": "أو",
    "عيان": "متعب",
    "عيانة": "متعبة",
    "الشي": "الشيء",
    "بلاصة": "مكان",
    "بلاصتي": "مكاني",
    # French words written in Arabic letters
    "مرسي": "شكرا",
    "ميرسي": "شكرا",
}
# Several words that mean one thing together, though each alone is ambiguous.
_PHRASES = {"شي واحد": "أحد", "شي حاجة": "شيء", "حتى واحد": "لا أحد", "هاد الشي": "هذا الشيء"}
_PHRASE = re.compile(
    "(?<![ء-ي])(" + "|".join(sorted(map(re.escape, _PHRASES), key=len, reverse=True)) + ")(?![ء-ي])"
)
# Nouns, also matched after "ال": الرونديفو -> الموعد. Mostly French borrowed into Darija.
_NOUNS = {
    "رونديفو": "موعد",
    "ريونيون": "اجتماع",
    "طوموبيل": "سيارة",
    "بورطابل": "هاتف",
    "تيليفون": "هاتف",
    "فاكتورة": "فاتورة",
    "كونجي": "عطلة",
    "بيرو": "مكتب",
}
# غادي is "going to" before a verb (غادي نمشي) and "going" otherwise (غادي للدار).
_GOING = {"غادي": ("سوف", "ذاهب"), "غادية": ("سوف", "ذاهبة"), "غاديين": ("سوف", "ذاهبون")}
_VERB_PREFIXES = "نتي"  # first letter of a present-tense verb: نمشي, تمشي, يمشي

_TABLE = {word.translate(_KEY): msa for word, msa in _WORDS.items()}
_NOUN_TABLE = {word.translate(_KEY): msa for word, msa in _NOUNS.items()}
_GOING_TABLE = {word.translate(_KEY): forms for word, forms in _GOING.items()}

# A run without a full stop longer than this is cut at connectors, into pieces of at least _MIN_PIECE words.
MAX_RUN_WORDS = 20
_MIN_PIECE = 5
_CONNECTORS = frozenset({"لكن", "ولكن", "لأن", "ولأن", "ثم", "وثم", "وبعد", "يعني", "إذن", "والآن"})
_SENTENCE_END = (".", "!", "?", "؟", "…")


def tidy(text: str) -> str:
    """Without diacritics, tatweel or letters stretched for emphasis."""
    return _STRETCHED.sub(r"\1", _DIACRITICS.sub("", text))


def _lookup(word: str, next_word: str) -> str | None:
    key = word.translate(_KEY)
    if key in _TABLE:
        return _TABLE[key]
    if key in _GOING_TABLE:
        future, going = _GOING_TABLE[key]
        return future if next_word[:1] in _VERB_PREFIXES and len(next_word) > 2 else going
    if key in _NOUN_TABLE:
        return _NOUN_TABLE[key]
    if key.startswith("ال") and key[2:] in _NOUN_TABLE:
        return "ال" + _NOUN_TABLE[key[2:]]
    return None


def _standard(word: str, next_word: str) -> str | None:
    """The Standard Arabic for one Darija word, or None to keep it."""
    found = _lookup(word, next_word)
    if found is None and word.startswith("فال") and len(word) > 4:
        # Darija ف before a noun is "in": فالدار -> في الدار
        return "في " + (_lookup(word[1:], next_word) or word[1:])
    if found is None and len(word) > 2 and word[0] in _PREFIXES:
        found = _lookup(word[1:], next_word)
        if found is not None:
            found = word[0] + found if found else word[0] + "+"  # و + dropped راه: glue و to the next word
    return found


def to_standard_arabic(text: str) -> str:
    """Rewrite the Darija words with one meaning into Standard Arabic; everything else is kept."""
    tokens = _PHRASE.sub(lambda m: _PHRASES[m.group()], text).split()
    out: list[str] = []
    pending = ""  # a replacement written onto the next word ("الخاص ب")
    for i, token in enumerate(tokens):
        word = token
        match = _WORD.search(token)
        if match is not None:
            next_word = tokens[i + 1] if i + 1 < len(tokens) else ""
            msa = _standard(match.group(), next_word)
            if msa is not None:
                # keep punctuation around the word: «دابا» or دابا،
                word = token[: match.start()] + msa + token[match.end() :]
        if word.endswith("+"):
            pending += word[:-1]
        elif word:
            out.append(pending + word)
            pending = ""
    if pending:
        out.append(pending)
    return " ".join(out)


def split_long_runs(text: str) -> str:
    """Put full stops before connectors in runs too long for the model to translate whole."""
    sentences: list[str] = []
    run: list[str] = []
    for word in text.split():
        run.append(word)
        if word.endswith(_SENTENCE_END):
            sentences.extend(_cut(run))
            run = []
    if run:
        sentences.extend(_cut(run))
    return " ".join(sentences)


def _cut(run: list[str]) -> list[str]:
    """One run of words (no full stop inside) as one or more sentences."""
    if len(run) <= MAX_RUN_WORDS:
        return [" ".join(run)]
    pieces: list[list[str]] = [[]]
    for i, word in enumerate(run):
        if word in _CONNECTORS and len(pieces[-1]) >= _MIN_PIECE and len(run) - i >= _MIN_PIECE:
            pieces.append([])
        pieces[-1].append(word)
    sentences = [" ".join(piece) for piece in pieces]
    return [s.rstrip("،,") + "." for s in sentences[:-1]] + sentences[-1:]


def prepare_source(text: str, language: str) -> str:
    """The text the translation model gets for a phrase spoken in ``language``."""
    if language != DARIJA:
        return text
    return split_long_runs(to_standard_arabic(tidy(text)))
