import numpy as np
import pytest

from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind, SttEngine, SttError, SttStream, Transcript, to_float32
from mawiid_ai.stt.config import FailoverSettings
from mawiid_ai.stt.router import SttRouter

PHRASE = SAMPLE_RATE  # fake engines emit one final per second of audio
CHUNK = SAMPLE_RATE // 10


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class FakeStream(SttStream):
    def __init__(self, engine: "FakeEngine", language: str, time_offset: float) -> None:
        self.engine = engine
        self.language = language
        self.offset = time_offset
        self.pending = 0
        self.consumed = 0
        engine.streams.append(self)

    def push_audio(self, audio):
        if self.engine.crash:
            raise RuntimeError(f"{self.engine.name} crashed")
        self.engine.clock.now += self.engine.call_seconds
        samples = len(to_float32(audio))
        self.engine.received += samples
        self.pending += samples
        results = []
        while self.pending >= PHRASE:
            results.append(self._final(PHRASE))
            self.pending -= PHRASE
        return results

    def flush(self):
        if self.engine.crash:
            raise RuntimeError(f"{self.engine.name} crashed")
        results = [self._final(self.pending)] if self.pending else []
        self.pending = 0
        return results

    def _final(self, samples: int) -> Transcript:
        start = self.offset + self.consumed / SAMPLE_RATE
        self.consumed += samples
        return Transcript(ResultKind.FINAL, self.engine.name, self.language, start, start + samples / SAMPLE_RATE, self.engine.name)


class FakeEngine(SttEngine):
    def __init__(self, name: str, clock: FakeClock, languages=("fr-FR",)) -> None:
        self.name = name
        self.clock = clock
        self.languages = set(languages)
        self.crash = False
        self.fail_open = False
        self.call_seconds = 0.0
        self.received = 0
        self.streams: list[FakeStream] = []

    def supports(self, language: str) -> bool:
        return language in self.languages

    def open_stream(self, language: str, time_offset: float = 0.0) -> SttStream:
        if self.fail_open:
            raise RuntimeError(f"{self.name} cannot open a stream")
        return FakeStream(self, language, time_offset)


@pytest.fixture
def clock():
    return FakeClock()


def make_router(clock, *engines, cooldown=60.0, slow=3.0):
    routes = {"fr-FR": [e.name for e in engines]}
    settings = FailoverSettings(cooldown_s=cooldown, slow_call_s=slow, max_replay_s=30.0)
    return SttRouter({e.name: e for e in engines}, routes, settings, clock=clock)


def push(stream, seconds: float):
    results = []
    for _ in range(round(seconds * SAMPLE_RATE / CHUNK)):
        results += stream.push_audio(np.zeros(CHUNK, dtype=np.int16))
    return results


def test_uses_primary_when_healthy(clock):
    primary, backup = FakeEngine("voxtral", clock), FakeEngine("whisper", clock)
    stream = make_router(clock, primary, backup).open_stream("fr-FR")
    results = push(stream, 2.0)
    assert [r.engine for r in results] == ["voxtral", "voxtral"]
    assert backup.received == 0


def test_skips_engines_that_are_not_loaded(clock):
    backup = FakeEngine("whisper", clock)
    router = SttRouter({"whisper": backup}, {"fr-FR": ["voxtral", "whisper"]}, FailoverSettings(), clock=clock)
    assert router.open_stream("fr-FR").engine == "whisper"


def test_unknown_language_is_rejected(clock):
    router = make_router(clock, FakeEngine("whisper", clock))
    with pytest.raises(SttError):
        router.open_stream("xx-XX")


def test_crash_switches_to_backup_and_replays_unfinalized_audio(clock):
    primary, backup = FakeEngine("voxtral", clock), FakeEngine("whisper", clock)
    stream = make_router(clock, primary, backup).open_stream("fr-FR")

    push(stream, 1.0)  # one final from the primary
    push(stream, 0.5)  # half a phrase buffered in the primary
    primary.crash = True
    results = push(stream, 0.5)

    assert stream.engine == "whisper"
    # The backup got the 0.5 s the primary never finalized plus the new 0.5 s: nothing lost, nothing doubled.
    assert backup.received == pytest.approx(SAMPLE_RATE, abs=CHUNK)
    assert [r.engine for r in results] == ["whisper"]
    assert results[0].start == pytest.approx(1.0, abs=CHUNK / SAMPLE_RATE)


def test_failed_engine_is_skipped_by_new_streams_until_cooldown(clock):
    primary, backup = FakeEngine("voxtral", clock), FakeEngine("whisper", clock)
    router = make_router(clock, primary, backup, cooldown=60.0)
    first = router.open_stream("fr-FR")
    primary.crash = True
    push(first, 0.2)

    assert router.open_stream("fr-FR").engine == "whisper"
    clock.now += 61
    primary.crash = False
    assert router.open_stream("fr-FR").engine == "voxtral"


def test_returns_to_primary_at_phrase_boundary_after_cooldown(clock):
    primary, backup = FakeEngine("voxtral", clock), FakeEngine("whisper", clock)
    stream = make_router(clock, primary, backup, cooldown=60.0).open_stream("fr-FR")
    primary.crash = True
    push(stream, 1.0)
    assert stream.engine == "whisper"

    primary.crash = False
    clock.now += 61
    push(stream, 1.0)  # whisper emits a final -> switch back scheduled
    results = push(stream, 1.0)
    assert stream.engine == "voxtral"
    assert results[-1].engine == "voxtral"


def test_slow_engine_hands_over_without_duplicating_finals(clock):
    primary, backup = FakeEngine("voxtral", clock), FakeEngine("whisper", clock)
    stream = make_router(clock, primary, backup, slow=3.0).open_stream("fr-FR")
    primary.call_seconds = 5.0  # every call takes 5 s: overloaded
    results = push(stream, 1.0)

    assert stream.engine == "whisper"
    assert len([r for r in results if r.kind is ResultKind.FINAL]) == 1


def test_slow_engine_is_kept_when_there_is_no_backup(clock):
    only = FakeEngine("whisper", clock)
    only.call_seconds = 5.0
    stream = make_router(clock, only).open_stream("fr-FR")
    assert len(push(stream, 1.0)) == 1
    assert stream.engine == "whisper"


def test_all_engines_failing_raises(clock):
    primary, backup = FakeEngine("voxtral", clock), FakeEngine("whisper", clock)
    stream = make_router(clock, primary, backup).open_stream("fr-FR")
    primary.crash = backup.crash = True
    with pytest.raises(SttError):
        push(stream, 0.1)


def test_flush_on_backup_after_crash(clock):
    primary, backup = FakeEngine("voxtral", clock), FakeEngine("whisper", clock)
    stream = make_router(clock, primary, backup).open_stream("fr-FR")
    push(stream, 0.5)
    primary.crash = True
    results = stream.flush()
    assert [r.engine for r in results] == ["whisper"]
    assert results[0].end - results[0].start == pytest.approx(0.5, abs=CHUNK / SAMPLE_RATE)


def test_engine_that_cannot_open_a_stream_is_skipped(clock):
    a, b, c = FakeEngine("voxtral", clock), FakeEngine("darija", clock), FakeEngine("whisper", clock)
    stream = make_router(clock, a, b, c).open_stream("fr-FR")
    b.fail_open = True
    a.crash = True
    results = push(stream, 1.0)
    assert stream.engine == "whisper"
    assert [r.engine for r in results] == ["whisper"]


def test_slow_replay_does_not_cascade_through_backups(clock):
    a, b, c = FakeEngine("voxtral", clock), FakeEngine("whisper-gpu", clock), FakeEngine("whisper", clock)
    stream = make_router(clock, a, b, c, slow=3.0).open_stream("fr-FR")
    push(stream, 0.9)
    a.crash = True
    b.call_seconds = 4.0  # replaying 0.9 s of audio takes a while; that alone is not "overloaded"
    push(stream, 0.1)
    assert stream.engine == "whisper-gpu"
