from mawiid_ai.stt.base import ResultKind, Transcript
from mawiid_ai.translation.darija import (
    MAX_RUN_WORDS,
    prepare_source,
    split_long_runs,
    tidy,
    to_standard_arabic,
)

from conftest import needs_languages
from test_translator import FakeEngine, by_language, make


def test_diacritics_tatweel_and_stretched_letters_are_removed():
    assert tidy("بزااااف") == "بزاف"
    assert tidy("مـــزيان") == "مزيان"
    assert tidy("دَابَا") == "دابا"


def test_doubled_letters_are_kept():
    assert tidy("الله") == "الله"


def test_darija_words_become_standard_arabic():
    assert to_standard_arabic("دابا كاين بزاف ديال الناس") == "الآن يوجد كثيرا الخاص بالناس"
    assert to_standard_arabic("واش نتا مزيان") == "هل أنت جيد"
    assert to_standard_arabic("خاصني نمشي حيت تعطلت") == "يجب علي نمشي لأن تعطلت"


def test_words_without_a_darija_meaning_are_kept():
    text = "السلام عليكم شي غير لي"
    assert to_standard_arabic(text) == text


def test_and_and_so_prefixes_are_kept():
    assert to_standard_arabic("ودابا فكيفاش") == "والآن فكيف"


def test_emphasis_particle_is_dropped():
    assert to_standard_arabic("راه مشى") == "مشى"
    assert to_standard_arabic("وراه مشى") == "ومشى"
    assert to_standard_arabic("راني تعبان") == "أنا تعبان"


def test_going_is_future_before_a_verb_and_motion_otherwise():
    assert to_standard_arabic("غادي نمشي") == "سوف نمشي"
    assert to_standard_arabic("غادي للدار") == "ذاهب للدار"
    assert to_standard_arabic("غادية تجي") == "سوف تجي"


def test_punctuation_around_words_is_kept():
    assert to_standard_arabic("شنو؟ دابا، «واش»") == "ماذا؟ الآن، «هل»"


def test_spelling_variants_match():
    assert to_standard_arabic("مزيانه") == "جيدة"


def test_french_words_in_arabic_letters():
    assert to_standard_arabic("عندي الرونديفو مع الطبيب مرسي") == "عندي الموعد مع الطبيب شكرا"
    assert to_standard_arabic("ريونيون") == "اجتماع"


def test_short_runs_are_not_split():
    text = "كنت في الدار ولكن ما لقيتش أحدا"
    assert split_long_runs(text) == text


def test_long_runs_are_split_at_connectors():
    first = " ".join(["كلمة"] * 12)
    second = " ".join(["حاجة"] * 12)
    out = split_long_runs(f"{first}، لكن {second}")
    assert out == f"{first}. لكن {second}"
    assert len(f"{first} لكن {second}".split()) > MAX_RUN_WORDS


def test_runs_that_already_have_full_stops_are_left_alone():
    text = " ".join(["كلمة"] * 10) + ". لكن " + " ".join(["حاجة"] * 10) + "."
    assert split_long_runs(text) == text


def test_a_connector_near_the_end_does_not_split_off_a_tiny_sentence():
    text = " ".join(["كلمة"] * 22) + " لكن لا"
    assert split_long_runs(text) == text


def test_only_darija_is_prepared():
    assert prepare_source("دابا بزاف", "ar-SA") == "دابا بزاف"
    assert prepare_source("دابا بزااااف", "ar-MA") == "الآن كثيرا"


@needs_languages("ar-MA")
def test_translator_sends_standard_arabic_to_the_model_and_keeps_the_original():
    engine = FakeEngine("madlad")
    original = "دابا خاصني نمشي"
    subs = by_language(
        make(engine).translate(Transcript(ResultKind.FINAL, original, "ar-MA", 0.0, 1.0, "whisper"), ["fr-FR", "ar-MA"])
    )
    assert engine.calls[0].text == "الآن يجب علي نمشي"
    assert subs["fr-FR"].source_text == original
    assert subs["ar-MA"].text == original  # Darija listeners read what was said


def test_f_before_a_noun_means_in():
    assert to_standard_arabic("فالدار") == "في الدار"
    assert to_standard_arabic("فالبيرو") == "في المكتب"


def test_phrases_are_rewritten_as_a_whole():
    assert to_standard_arabic("واش كاين شي واحد") == "هل يوجد أحد"
    assert to_standard_arabic("ما لقيت حتى واحد") == "ما لقيت لا أحد"
