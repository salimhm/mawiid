from mawiid_ai.stt.postprocess import clean_text


def test_traditional_chinese_is_converted_for_zh_tw():
    assert clean_text("这是简体中文", "zh-TW") == "這是簡體中文"


def test_simplified_chinese_is_enforced_for_zh_cn():
    assert clean_text("這是繁體中文", "zh-CN") == "这是繁体中文"


def test_other_languages_only_get_whitespace_cleanup():
    assert clean_text("  Bonjour   tout le monde ", "fr-FR") == "Bonjour tout le monde"


from mawiid_ai.stt.postprocess import implausible_length, is_hallucination, repeats_context


def test_whisper_stock_phrases_over_silence_are_hallucinations():
    for text in [
        "you",
        "Thank you.",
        "Sous-titres réalisés par la communauté des Amara.org",
        "Sssssssssssssssss",
        "سر. سر. سر.",
        "...",
    ]:
        assert is_hallucination(text), text


def test_real_speech_is_not_a_hallucination():
    for text in ["I don't know.", "Thank you for coming today.", "Bonjour à tous.", "شكرا جزيلا يا أحمد"]:
        assert not is_hallucination(text), text


def test_echo_of_the_prompt_is_detected():
    assert repeats_context("I don't know.", "We tried twice. I don't know.")
    assert not repeats_context("I don't know.", "We tried twice.")
    assert not repeats_context("Yes", "")


def test_text_far_too_long_for_its_audio_is_made_up():
    assert implausible_length("x" * 200, 1.0)
    assert implausible_length("x" * 60, 1.0)
    assert not implausible_length("Bonjour à tous, je pense que", 2.0)
    assert not implausible_length("D'accord, merci.", 0.6)
    assert not implausible_length("x" * 200, 10.0)
    assert not implausible_length("x" * 200, 0.1)  # too short to judge
