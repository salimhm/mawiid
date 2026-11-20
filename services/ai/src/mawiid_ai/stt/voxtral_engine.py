"""Stream Darija speech to a local vLLM Voxtral Realtime server."""

from __future__ import annotations

import base64
import json
import time

import numpy as np
from websockets.sync.client import connect

from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind, SttEngine, SttError, SttStream, Transcript, to_float32
from mawiid_ai.stt.config import VadSettings, VoxtralSettings
from mawiid_ai.stt.postprocess import clean_text
from mawiid_ai.stt.vad import SpeechSegment, VadSegmenter

CHUNK_SAMPLES = 2048  # 128 ms of PCM16


class VoxtralEngine(SttEngine):
    name = "voxtral-arabic"
    requires_explicit_language = True

    def __init__(self, settings: VoxtralSettings, vad: VadSettings) -> None:
        self._settings = settings
        self._vad = vad

    def supports(self, language: str) -> bool:
        return language == "ar-MA"

    def open_stream(self, language: str, time_offset: float = 0.0, detect: bool = True) -> SttStream:
        if detect or not self.supports(language):
            raise SttError("Voxtral requires an explicit Darija spoken language")
        return VoxtralStream(self._settings, self._vad, language, time_offset)


class VoxtralStream(SttStream):
    def __init__(self, settings: VoxtralSettings, vad: VadSettings, language: str, time_offset: float) -> None:
        self._settings = settings
        self._vad = VadSegmenter(vad)
        self._language = language
        self._offset = time_offset
        self._socket = None
        self._start = 0
        self._sent = 0
        self._text = ""
        self._partial = ""

    def push_audio(self, audio: np.ndarray | bytes) -> list[Transcript]:
        results = [result for segment in self._vad.feed(to_float32(audio)) if (result := self._finish(segment))]
        if not self._vad.in_speech:
            self.close()
            return results

        start = self._vad.segment_start
        # This prefix only grows within a phrase because the trim cannot grow faster than the audio.
        current = self._vad.current_audio(trim_trailing=True)
        available = len(current) - len(current) % CHUNK_SAMPLES
        if available:
            self._send_audio(start, current[:available])
            self._read_partial()
            partial = clean_text(self._text, self._language)
            if partial and partial != self._partial:
                self._partial = partial
                results.append(self._transcript(ResultKind.PARTIAL, partial, start, start + len(current)))
        return results

    def flush(self) -> list[Transcript]:
        try:
            return [result for segment in self._vad.flush() if (result := self._finish(segment))]
        finally:
            self.close()

    def close(self) -> None:
        if self._socket is not None:
            socket, self._socket = self._socket, None
            socket.close()

    def _finish(self, segment: SpeechSegment) -> Transcript | None:
        try:
            self._send_audio(segment.start_sample, segment.audio)
            self._send(type="input_audio_buffer.commit", final=True)
            deadline = time.monotonic() + self._settings.timeout_s
            while time.monotonic() < deadline:
                event = self._receive(deadline - time.monotonic())
                if event["type"] == "transcription.done":
                    text = clean_text(event["text"], self._language)
                    if text:
                        return self._transcript(ResultKind.FINAL, text, segment.start_sample, segment.end_sample)
                    return None
            raise SttError("Voxtral did not finalize the phrase before the timeout")
        finally:
            self.close()

    def _send_audio(self, start: int, audio: np.ndarray) -> None:
        if self._socket is None or start != self._start:
            self.close()
            self._socket = connect(
                self._settings.url,
                proxy=None,
                open_timeout=self._settings.timeout_s,
                close_timeout=0.25,
            )
            self._start, self._sent, self._text, self._partial = start, 0, "", ""
            if self._receive(self._settings.timeout_s)["type"] != "session.created":
                raise SttError("Voxtral did not create a realtime session")
            self._send(type="session.update", model=self._settings.model)
            self._send(type="input_audio_buffer.commit")

        for offset in range(self._sent, len(audio), CHUNK_SAMPLES):
            samples = audio[offset : offset + CHUNK_SAMPLES]
            pcm = np.clip(np.rint(samples * 32768), -32768, 32767).astype("<i2")
            self._send(type="input_audio_buffer.append", audio=base64.b64encode(pcm.tobytes()).decode("ascii"))
        self._sent = len(audio)

    def _send(self, **event: str | bool) -> None:
        self._socket.send(json.dumps(event))

    def _receive(self, timeout: float) -> dict:
        event = json.loads(self._socket.recv(timeout=max(0, timeout)))
        if event["type"] == "error":
            raise SttError(f"Voxtral realtime error: {event.get('code', 'unknown')}")
        return event

    def _read_partial(self) -> None:
        while True:
            try:
                event = self._receive(0)
            except TimeoutError:
                return
            if event["type"] == "transcription.delta":
                self._text += event["delta"]
            elif event["type"] == "transcription.done":
                raise SttError("Voxtral finalized before the end of the phrase")

    def _transcript(self, kind: ResultKind, text: str, start: int, end: int) -> Transcript:
        return Transcript(
            kind, text, self._language, self._offset + start / SAMPLE_RATE,
            self._offset + end / SAMPLE_RATE, VoxtralEngine.name,
        )
