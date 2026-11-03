from mawiid_ai.translation.postprocess import clean_translation


def test_escaped_apostrophes_are_rejoined():
    # MADLAD writes Moses-style escapes with spaces around them.
    assert clean_translation("Il n &apos; a pas fixé de chiffre", "fr-FR") == "Il n'a pas fixé de chiffre"
    assert clean_translation("the Earth &apos; s atmosphere", "en-US") == "the Earth's atmosphere"


def test_other_html_entities_are_unescaped():
    assert clean_translation("il a dit &quot;non&quot;", "fr-FR") == 'il a dit "non"'


def test_chinese_gets_full_width_punctuation_after_chinese_text():
    assert clean_translation("大坝建成后,季节性洪水被控制住了?", "zh-CN") == "大坝建成后，季节性洪水被控制住了？"


def test_chinese_numbers_keep_their_ascii_separators():
    assert clean_translation("价格是1,000元", "zh-CN") == "价格是1,000元"


def test_traditional_chinese_listeners_get_traditional_script():
    assert clean_translation("这是简体中文", "zh-TW") == "這是簡體中文"


def test_whitespace_is_collapsed():
    assert clean_translation("  Bonjour   à tous ", "fr-FR") == "Bonjour à tous"
