"""Picks an engine per language and switches to the backup when one fails.

Each language has an ordered list of engines (config.DEFAULT_ROUTES). A stream
starts on the first engine that is loaded and healthy. If that engine crashes,
the stream switches to the next one and replays the audio since the last final
result, so no speech is lost. A failed engine is skipped by every stream for a
cooldown period (circuit breaker), then retried at the next phrase boundary.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping

import numpy as np

from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind, SttEngine, SttError, SttStream, Transcript, to_float32
from mawiid_ai.stt.config import LANGUAGES, FailoverSettings

log = logging.getLogger(__name__)

Clock = Callable[[], float]


class CircuitBreaker:
    """Shared across streams: once an engine fails, nobody uses it until the cooldown ends."""

    def __init__(self, cooldown_s: float, clock: Clock = time.monotonic) -> None:
        self._cooldown = cooldown_s
        self._clock = clock
        self._open_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def available(self, engine: str) -> bool:
        with self._lock:
            return self._clock() >= self._open_until.get(engine, 0.0)

    def record_failure(self, engine: str, reason: str) -> None:
        with self._lock:
            self._open_until[engine] = self._clock() + self._cooldown
        log.warning("engine %s marked down for %.0fs: %s", engine, self._cooldown, reason)


class SttRouter:
    def __init__(
        self,
        engines: Mapping[str, SttEngine],
        routes: Mapping[str, list[str]],
        settings: FailoverSettings,
        clock: Clock = time.monotonic,
    ) -> None:
        self.engines = dict(engines)
        self.routes = {lang: list(chain) for lang, chain in routes.items()}
        self.settings = settings
        self.clock = clock
        self.breaker = CircuitBreaker(settings.cooldown_s, clock)

    def chain_for(self, language: str) -> list[str]:
        """Loaded engines that support the language, in preference order."""
        if language not in LANGUAGES:
            raise SttError(f"unsupported language: {language}")
        return [
            name
            for name in self.routes.get(language, [])
            if name in self.engines and self.engines[name].supports(language)
        ]

    def open_stream(self, language: str) -> FailoverStream:
        chain = self.chain_for(language)
        if not chain:
            raise SttError(f"no speech-to-text engine loaded for {language}")
        return FailoverStream(self, language, chain)


class FailoverStream(SttStream):
    def __init__(self, router: SttRouter, language: str, chain: list[str]) -> None:
        self._router = router
        self._language = language
        self._chain = chain
        self._max_replay = int(router.settings.max_replay_s * SAMPLE_RATE)
        # Audio since the last final result, as (start_sample, chunk).
        self._replay: deque[tuple[int, np.ndarray]] = deque()
        self._replay_samples = 0
        self._samples_seen = 0
        self._switch_back_to: int | None = None
        self._index = self._first_available(0)
        self._stream = self._open(self._index, time_offset=0.0)

    @property
    def engine(self) -> str:
        """Engine currently serving this stream."""
        return self._chain[self._index]

    def push_audio(self, audio: np.ndarray | bytes) -> list[Transcript]:
        chunk = to_float32(audio)
        self._remember(chunk)
        return self._call(lambda stream: stream.push_audio(chunk), flush=False)

    def flush(self) -> list[Transcript]:
        results = self._call(lambda stream: stream.flush(), flush=True)
        self._replay.clear()
        self._replay_samples = 0
        return results

    def close(self) -> None:
        self._stream.close()

    # -- internals ---------------------------------------------------------

    def _call(self, op: Callable[[SttStream], list[Transcript]], flush: bool) -> list[Transcript]:
        replaying = False
        if self._switch_back_to is not None:
            target, self._switch_back_to = self._switch_back_to, None
            if self._try_switch(target):
                log.info("stt %s: back to %s", self._language, self.engine)
                op, replaying = self._replay_op(flush), True  # the replay already contains the new chunk

        collected: list[Transcript] = []
        while True:
            name = self.engine
            started = self._router.clock()
            try:
                results = op(self._stream)
            except Exception as exc:  # any engine crash triggers the backup
                self._router.breaker.record_failure(name, repr(exc))
                self._take_over()
                op, replaying = self._replay_op(flush), True
                continue

            collected += results
            self._forget_finalized(results)
            elapsed = self._router.clock() - started
            # Replays carry seconds of audio at once, so only live calls are judged on speed.
            if not replaying and elapsed > self._router.settings.slow_call_s and self._has_alternative():
                # The results are fine, but this engine can't keep up: move to the backup
                # and replay only what hasn't been finalized yet.
                self._router.breaker.record_failure(name, f"slow call ({elapsed:.1f}s)")
                self._take_over()
                op, replaying = self._replay_op(flush), True
                continue

            if any(r.kind is ResultKind.FINAL for r in results):
                # Phrase boundary: go back to a preferred engine on the next call if it has recovered.
                better = self._first_available(0, required=False)
                if better is not None and better < self._index:
                    self._switch_back_to = better
            return collected

    def _replay_op(self, flush: bool) -> Callable[[SttStream], list[Transcript]]:
        chunks = [chunk for _, chunk in self._replay]

        def replay(stream: SttStream) -> list[Transcript]:
            results = stream.push_audio(np.concatenate(chunks)) if chunks else []
            return results + stream.flush() if flush else results

        return replay

    def _forget_finalized(self, results: list[Transcript]) -> None:
        finals = [r for r in results if r.kind is ResultKind.FINAL]
        if finals:
            self._forget_before(round(finals[-1].end * SAMPLE_RATE))

    def _take_over(self) -> None:
        while True:
            nxt = self._first_available(0, required=False, exclude=self._index)
            if nxt is None:
                raise SttError(f"all speech-to-text engines failed for {self._language}")
            log.warning("stt %s: switching %s -> %s", self._language, self.engine, self._chain[nxt])
            if self._try_switch(nxt):
                return

    def _try_switch(self, index: int) -> bool:
        """Open a stream on another engine; the current stream is only closed once that worked."""
        start = self._replay[0][0] if self._replay else self._samples_seen
        try:
            stream = self._open(index, time_offset=start / SAMPLE_RATE)
        except Exception as exc:
            self._router.breaker.record_failure(self._chain[index], f"open failed: {exc!r}")
            return False
        try:
            self._stream.close()
        except Exception:
            log.exception("closing stt stream failed")
        self._index, self._stream = index, stream
        return True

    def _open(self, index: int, time_offset: float) -> SttStream:
        return self._router.engines[self._chain[index]].open_stream(self._language, time_offset=time_offset)

    def _first_available(self, start: int, required: bool = True, exclude: int | None = None) -> int | None:
        for i in range(start, len(self._chain)):
            if i != exclude and self._router.breaker.available(self._chain[i]):
                return i
        if required:
            # Everything is cooling down: use the first engine anyway rather than going silent.
            return 0
        return None

    def _has_alternative(self) -> bool:
        return self._first_available(0, required=False, exclude=self._index) is not None

    def _remember(self, chunk: np.ndarray) -> None:
        self._replay.append((self._samples_seen, chunk))
        self._samples_seen += len(chunk)
        self._replay_samples += len(chunk)
        while self._replay_samples > self._max_replay and len(self._replay) > 1:
            _, dropped = self._replay.popleft()
            self._replay_samples -= len(dropped)

    def _forget_before(self, sample: int) -> None:
        """Drop audio already covered by a final result, keeping the chunk that contains ``sample``."""
        while len(self._replay) > 1 and self._replay[1][0] <= sample:
            _, dropped = self._replay.popleft()
            self._replay_samples -= len(dropped)
