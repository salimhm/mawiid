"""Local translation of transcripts into each listener's language.

    translator = build_translator()
    for result in stream.push_audio(chunk):          # speech-to-text results of one speaker
        for subtitle in translator.translate(result, room_languages):
            send(subtitle.language, subtitle.text)   # every listener of that language
"""

from mawiid_ai.translation.base import Subtitle, TranslationEngine, TranslationError
from mawiid_ai.translation.config import MadladSettings, TranslationSettings
from mawiid_ai.translation.factory import build_translator, load_engines
from mawiid_ai.translation.translator import SubtitleTranslator

__all__ = [
    "MadladSettings",
    "Subtitle",
    "SubtitleTranslator",
    "TranslationEngine",
    "TranslationError",
    "TranslationSettings",
    "build_translator",
    "load_engines",
]
