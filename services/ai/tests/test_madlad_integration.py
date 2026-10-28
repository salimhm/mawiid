"""Runs the real MADLAD model. Skipped until `python scripts/convert_translation_model.py` has run."""

from pathlib import Path

import pytest

from mawiid_ai.stt.base import ResultKind, Transcript
from mawiid_ai.translation.config import MadladSettings, TranslationSettings

MODEL = Path(MadladSettings().model_path)

pytestmark = pytest.mark.skipif(not (MODEL / "model.bin").exists(), reason="no converted translation model")


@pytest.fixture(scope="module")
def madlad():
    from mawiid_ai.translation.madlad_engine import MadladEngine

    return MadladEngine(MadladSettings())


def test_language_tag_reaches_the_model_as_one_token(madlad):
    # Same pieces as the Hugging Face tokenizer (checked by convert_translation_model.py): a word-start marker, then the tag.
    pieces = madlad.encode("Bonjour", "ar-SA")
    assert pieces[:2] == ["▁", "<2ar>"]
    assert pieces[-1] == "</s>"


def test_french_sentence_is_translated_into_every_other_language(madlad):
    en, ar, zh = madlad.translate("Le chat dort sur le canapé.", "fr-FR", ["en-US", "ar-SA", "zh-CN"])
    assert "cat" in en.lower() and ("sofa" in en.lower() or "couch" in en.lower())
    assert "القط" in ar
    assert "猫" in zh


def test_every_sentence_of_a_multi_sentence_final_is_translated(madlad):
    # Given both sentences at once, MADLAD silently dropped the first one.
    text = (
        "Also between each dynasty was an unstable age of divided provinces. The best-known of these periods "
        "was the Three Kingdoms epoch taking place for 60 years between the Han and the Jin Dynasty."
    )
    [zh] = madlad.translate(text, "en-US", ["zh-CN"])
    assert "不稳定" in zh and "三国" in zh


def test_runaway_repetition_is_recovered(madlad):
    # FLEURS sentence on which MADLAD loops "1-2-2-1-1-1-1-..." instead of translating.
    text = "Swirl the two dry powders together and then, with clean wet hands, squeeze them into a ball."
    [ar] = madlad.translate(text, "en-US", ["ar-SA"])
    assert "1-1-1-1" not in ar
    assert "كرة" in ar  # "ball"


def test_translator_produces_subtitles_with_the_real_model(madlad):
    from mawiid_ai.translation.translator import SubtitleTranslator

    translator = SubtitleTranslator({"madlad": madlad}, TranslationSettings(engines=["madlad"]))
    final = Transcript(ResultKind.FINAL, "Hello everyone, can you hear me?", "en-US", 0.0, 2.0, "whisper")
    subs = {s.language: s.text for s in translator.translate(final, ["fr-FR", "zh-TW", "en-US"])}
    assert subs["en-US"] == "Hello everyone, can you hear me?"
    assert "entend" in subs["fr-FR"].lower()
    assert "聽" in subs["zh-TW"] and "听" not in subs["zh-TW"]
