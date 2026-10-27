"""Runs the converted Darija model on real Darija speech.

Skipped until `scripts/convert_darija_model.py` and `scripts/fetch_samples.py --languages ar-MA` have run.
"""

import json
from pathlib import Path

import numpy as np
import pytest

from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind
from mawiid_ai.stt.config import DEFAULT_ROUTES, SttSettings
from mawiid_ai.stt.router import SttRouter

SAMPLES = Path(__file__).resolve().parent.parent / "data" / "samples" / "ar-MA"
SETTINGS = SttSettings()

pytestmark = [
    pytest.mark.skipif(not (Path(SETTINGS.darija.model) / "model.bin").exists(), reason="no converted darija model"),
    pytest.mark.skipif(not (SAMPLES / "manifest.jsonl").exists(), reason="no darija sample clips"),
]


@pytest.fixture(scope="module")
def router():
    from mawiid_ai.stt.whisper_engine import WhisperEngine

    darija = WhisperEngine(SETTINGS.darija, SETTINGS.vad, name="whisper-darija", languages=["ar-MA"])
    return SttRouter({"whisper-darija": darija}, DEFAULT_ROUTES, SETTINGS.failover)


def test_darija_conversation_is_transcribed_in_arabic_script(router):
    sf = pytest.importorskip("soundfile")
    jiwer = pytest.importorskip("jiwer")
    entries = [json.loads(line) for line in (SAMPLES / "manifest.jsonl").read_text(encoding="utf-8").splitlines()]
    entry = next(e for e in entries if e.get("source") == "adiren7")
    audio, _ = sf.read(SAMPLES / entry["audio"], dtype="float32")
    audio = np.concatenate([audio, np.zeros(SAMPLE_RATE, dtype=np.float32)])

    stream = router.open_stream("ar-MA")
    results = []
    for i in range(0, len(audio), SAMPLE_RATE // 50):
        results += stream.push_audio(audio[i : i + SAMPLE_RATE // 50])
    results += stream.flush()
    finals = [r for r in results if r.kind is ResultKind.FINAL]
    text = " ".join(r.text for r in finals)

    assert finals and all(r.engine == "whisper-darija" for r in finals)
    arabic = sum("؀" <= ch <= "ۿ" for ch in text)
    assert arabic > 0.8 * len(text.replace(" ", ""))
    assert jiwer.cer(entry["text"].replace(" ", ""), text.replace(" ", "")) < 0.5
