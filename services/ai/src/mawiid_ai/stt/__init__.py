"""Real-time speech-to-text.

    router = build_router()
    stream = router.open_stream("fr-FR")   # one per speaker
    for chunk in audio_chunks:             # 16 kHz mono int16/float32
        for result in stream.push_audio(chunk):
            print(result.kind, result.text)
    stream.flush()
"""

from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind, SttEngine, SttError, SttStream, Transcript
from mawiid_ai.stt.config import LANGUAGES, SttSettings
from mawiid_ai.stt.factory import build_router, load_engines
from mawiid_ai.stt.router import FailoverStream, SttRouter

__all__ = [
    "LANGUAGES",
    "SAMPLE_RATE",
    "FailoverStream",
    "ResultKind",
    "SttEngine",
    "SttError",
    "SttRouter",
    "SttSettings",
    "SttStream",
    "Transcript",
    "build_router",
    "load_engines",
]
