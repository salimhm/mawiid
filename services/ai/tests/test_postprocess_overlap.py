from mawiid_ai.stt.postprocess import remove_overlap


def test_removes_repeated_words_ignoring_case_and_punctuation():
    assert remove_overlap(["we", "should", "talk."], "Talk, about it") == ("about it", ["Talk,"])


def test_takes_the_longest_match():
    assert remove_overlap(["a", "b", "a", "b"], "a b c") == ("c", ["a", "b"])


def test_keeps_text_without_a_match():
    assert remove_overlap(["bonjour"], "hello there") == ("hello there", [])


def test_ignores_arabic_vowel_marks():
    assert remove_overlap(["مَرْحَبًا"], "مرحبا بكم") == ("بكم", ["مرحبا"])


def test_punctuation_alone_is_not_a_match():
    assert remove_overlap(["-"], "- bonjour") == ("- bonjour", [])


def test_nothing_before_it():
    assert remove_overlap([], "bonjour") == ("bonjour", [])
