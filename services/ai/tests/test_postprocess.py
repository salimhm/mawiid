from mawiid_ai.stt.postprocess import clean_text


def test_traditional_chinese_is_converted_for_zh_tw():
    assert clean_text("这是简体中文", "zh-TW") == "這是簡體中文"


def test_simplified_chinese_is_enforced_for_zh_cn():
    assert clean_text("這是繁體中文", "zh-CN") == "这是繁体中文"


def test_other_languages_only_get_whitespace_cleanup():
    assert clean_text("  Bonjour   tout le monde ", "fr-FR") == "Bonjour tout le monde"
