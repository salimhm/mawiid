"""A bounded hand-off between a speaker's LiveKit audio and the caption pipeline.

LiveKit's AudioStream buffers without limit. When speech-to-text falls behind (a busy CPU, too
many speakers), the audio would pile up at 32 KB/s per speaker until the process runs out of
memory. Here a speaker holds at most ``max_backlog_s`` of audio: a slow decoder makes captions
skip, never memory grow. On overflow the whole backlog is dropped, not just the oldest chunk, so
the pipeline resumes on live speech instead of stitching stale fragments together.
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncIterator

import numpy as np

from mawiid_ai.metrics import caption_audio_dropped_seconds

DEFAULT_MAX_BACKLOG_S = 5.0


class BoundedAudio:
    """Async iterator of audio chunks fed by ``put`` and capped at ``max_backlog_s`` of audio."""

    def __init__(self, chunk_s: float, max_backlog_s: float = DEFAULT_MAX_BACKLOG_S) -> None:
        self._chunk_s = chunk_s
        self._capacity = max(1, int(round(max_backlog_s / chunk_s)))
        self.max_backlog_s = self._capacity * chunk_s
        self._chunks: deque[np.ndarray] = deque()
        self._ready = asyncio.Event()
        self._ended = False
        self.dropped_s = 0.0  # audio thrown away because the pipeline was behind
        self.overflows = 0

    @property
    def backlog_s(self) -> float:
        """Audio received but not yet handed to the pipeline."""
        return len(self._chunks) * self._chunk_s

    def put(self, chunk: np.ndarray) -> None:
        if self._ended:
            return
        if len(self._chunks) >= self._capacity:
            dropped = len(self._chunks) * self._chunk_s
            self._chunks.clear()
            self.dropped_s += dropped
            self.overflows += 1
            caption_audio_dropped_seconds.inc(amount=dropped)
        self._chunks.append(chunk)
        self._ready.set()

    def end(self) -> None:
        self._ended = True
        self._ready.set()

    def __aiter__(self) -> AsyncIterator[np.ndarray]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[np.ndarray]:
        while True:
            if self._chunks:
                yield self._chunks.popleft()
                continue
            if self._ended:
                return
            self._ready.clear()
            await self._ready.wait()
