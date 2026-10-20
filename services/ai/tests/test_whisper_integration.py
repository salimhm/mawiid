"""Runs real Whisper on real speech. Skipped until `python scripts/fetch_samples.py` has run."""

import json
from pathlib import Path

import numpy as np
import pytest

from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind, SttEngine, SttStream
from mawiid_ai.stt.config import DEFAULT_ROUTES, SttSettings
from mawiid_ai.stt.router import SttRouter

SAMPLES = Path(__file__).resolve().parent.parent / "data" / "samples"
CHUNK = SAMPLE_RATE // 50

pytestmark = pytest.mark.skipif(not (SAMPLES / "fr-FR" / "manifest.jsonl").exists(), reason="no sample clips")


@pytest.fixture(scope="module")
def whisper():
    from mawiid_ai.stt.whisper_engine import WhisperEngine

    settings = SttSettings()
    return WhisperEngine(settings.whisper, settings.vad)


def clip(language: str) -> tuple[np.ndarray, str]:
    sf = pytest.importorskip("soundfile")
    entry = json.loads((SAMPLES / language / "manifest.jsonl").read_text(encoding="utf-8").splitlines()[0])
    audio, _ = sf.read(SAMPLES / language / entry["audio"], dtype="float32")
    return np.concatenate([audio, np.zeros(SAMPLE_RATE, dtype=np.float32)]), entry["text"]


def stream_through(stream: SttStream, audio: np.ndarray, crash_at: float | None = None, engine=None):
    results = []
    for i in range(0, len(audio), CHUNK):
        if crash_at is not None and i >= crash_at * SAMPLE_RATE:
            engine.crash = True
        results += stream.push_audio(audio[i : i + CHUNK])
    return results + stream.flush()


class CrashingEngine(SttEngine):
    """Stands in for Voxtral: accepts audio, then crashes when told to."""

    name = "voxtral"

    def __init__(self) -> None:
        self.crash = False

    def supports(self, language: str) -> bool:
        return True

    def open_stream(self, language: str, time_offset: float = 0.0) -> SttStream:
        engine = self

        class Stream(SttStream):
            def push_audio(self, audio):
                if engine.crash:
                    raise RuntimeError("GPU out of memory")
                return []

            def flush(self):
                return self.push_audio(b"")

        return Stream()


def test_french_clip_is_transcribed(whisper):
    audio, reference = clip("fr-FR")
    router = SttRouter({"whisper": whisper}, DEFAULT_ROUTES, SttSettings().failover)
    finals = [r for r in stream_through(router.open_stream("fr-FR"), audio) if r.kind is ResultKind.FINAL]
    text = " ".join(r.text for r in finals).lower()
    assert "terrain montagneux" in text
    assert all(r.engine == "whisper" for r in finals)


def test_backup_takes_over_mid_sentence_without_losing_speech(whisper):
    audio, _ = clip("fr-FR")
    primary = CrashingEngine()
    router = SttRouter({"voxtral": primary, "whisper": whisper}, DEFAULT_ROUTES, SttSettings().failover)
    stream = router.open_stream("fr-FR")
    assert stream.engine == "voxtral"

    # The primary dies 3 s into the sentence; whisper must still produce the whole sentence.
    results = stream_through(stream, audio, crash_at=3.0, engine=primary)
    text = " ".join(r.text for r in results if r.kind is ResultKind.FINAL).lower()
    assert stream.engine == "whisper"
    assert text.startswith("l'accident a eu lieu")
    assert "malveillant" in text
