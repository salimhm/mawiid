import base64
import json
from collections import deque

import numpy as np
import pytest

pytest.importorskip("websockets.sync.client")

from mawiid_ai.stt import vad, voxtral_engine
from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind
from mawiid_ai.stt.config import VadSettings, VoxtralSettings


class FakeSocket:
    def __init__(self):
        self.sent = []
        self.inbox = deque([{"type": "session.created"}])
        self.closed = False

    def send(self, message):
        event = json.loads(message)
        self.sent.append(event)
        if event["type"] == "input_audio_buffer.append":
            if len(self.sent) == 3:
                self.inbox.append({"type": "transcription.delta", "delta": "سلام"})
        elif event.get("final"):
            self.inbox.append({"type": "transcription.done", "text": "سلام عليكم"})

    def recv(self, timeout):
        if not self.inbox:
            raise TimeoutError
        return json.dumps(self.inbox.popleft())

    def close(self):
        self.closed = True


class EnergyVad:
    def __call__(self, window):
        return float(np.any(window))

    def reset(self):
        pass


def test_voxtral_streams_partials_and_finalizes_only_vad_audio(monkeypatch):
    client = FakeSocket()
    monkeypatch.setattr(vad, "SileroVad", EnergyVad)
    monkeypatch.setattr(voxtral_engine, "connect", lambda *args, **kwargs: client)
    engine = voxtral_engine.VoxtralEngine(VoxtralSettings(), VadSettings())
    stream = engine.open_stream("ar-MA", time_offset=2.0, detect=False)
    speech = np.full(16 * vad.WINDOW, -32768, dtype=np.int16)
    silence = np.zeros(20 * vad.WINDOW, dtype=np.int16)

    [partial] = stream.push_audio(speech[: 8 * vad.WINDOW])
    assert partial.kind is ResultKind.PARTIAL
    assert partial.text == "سلام"
    assert not any(event.get("final") for event in client.sent)
    assert stream.push_audio(speech[8 * vad.WINDOW :]) == []
    [final] = stream.push_audio(silence)
    assert final.kind is ResultKind.FINAL
    assert (final.engine, final.language, final.text) == ("voxtral-arabic", "ar-MA", "سلام عليكم")
    sent = b"".join(base64.b64decode(e["audio"]) for e in client.sent if "audio" in e)
    assert sent == speech.astype("<i2").tobytes() + bytes(2 * 3200)
    assert final.start == 2.0
    assert final.end == pytest.approx(2 + (len(speech) + 3200) / SAMPLE_RATE)
    assert client.closed
    assert stream.flush() == []
