import pytest

from mawiid_ai.stt.config import LANGUAGES


def needs_languages(*codes: str) -> pytest.MarkDecorator:
    """Skip a test while one of these languages is switched off (MAWIID_LANGUAGES)."""
    off = [code for code in codes if code not in LANGUAGES]
    return pytest.mark.skipif(bool(off), reason=f"{', '.join(off)} switched off (MAWIID_LANGUAGES)")
