import asyncio
import json

import numpy as np

from mawiid_ai.agent.backlog import BoundedAudio
from mawiid_ai.agent.pipeline import (
    CAPTION_STATUS_TOPIC,
    SHED_DOWN_AFTER_S,
    SHED_UP_EVERY_S,
    TRANSCRIPTION_TOPIC,
    TRANSLATION_TOPIC,
)
from mawiid_ai.stt.base import SAMPLE_RATE

from tests.test_pipeline import CHUNK, PHRASE_CHUNKS, FakeStream, Room

CHUNK_S = 0.1


def chunk() -> np.ndarray:
    return np.zeros(SAMPLE_RATE // 10, dtype=np.int16)


def test_backlog_never_holds_more_than_its_capacity_and_counts_what_it_drops():
    backlog = BoundedAudio(CHUNK_S, max_backlog_s=0.5)
    for _ in range(5):
        backlog.put(chunk())
    assert backlog.backlog_s == 0.5
    backlog.put(chunk())  # full: the stale backlog goes, live audio stays
    assert backlog.overflows == 1
    assert abs(backlog.dropped_s - 0.5) < 1e-9
    assert abs(backlog.backlog_s - 0.1) < 1e-9
    for _ in range(10_000):  # a decoder that never catches up: memory stays bounded
        backlog.put(chunk())
    assert backlog.backlog_s <= 0.5


def test_backlog_hands_over_what_is_left_after_the_speaker_ends():
    async def run():
        backlog = BoundedAudio(CHUNK_S, max_backlog_s=1.0)
        for _ in range(3):
            backlog.put(chunk())
        backlog.end()
        backlog.put(chunk())  # after the end: ignored
        return [c async for c in backlog]

    assert len(asyncio.run(run())) == 3


def test_backlog_waits_for_audio():
    async def run():
        backlog = BoundedAudio(CHUNK_S)
        received = []

        async def consume():
            async for c in backlog:
                received.append(c)

        task = asyncio.create_task(consume())
        await asyncio.sleep(0)
        backlog.put(chunk())
        await asyncio.sleep(0)
        backlog.end()
        await task
        return received

    assert len(asyncio.run(run())) == 1


class ScriptedBacklog:
    """Audio whose reported backlog follows a script, like a BoundedAudio behind a slow decoder."""

    def __init__(self, backlogs, clock, step_s=1.0, overflow_at=()):
        self.backlogs = backlogs
        self.clock = clock
        self.step_s = step_s
        self.overflow_at = set(overflow_at)
        self.backlog_s = 0.0
        self.overflows = 0

    def __aiter__(self):
        return self._run()

    async def _run(self):
        for i, backlog in enumerate(self.backlogs):
            self.backlog_s = backlog
            if i in self.overflow_at:
                self.overflows += 1
            self.clock[0] += self.step_s
            yield np.zeros(CHUNK, dtype=np.int16)


def scripted_room(translate=True):
    now = [0.0]
    room = Room(translate=translate)
    room.pipeline._clock = lambda: now[0]
    room.pipeline._shed_changed_at = 0.0
    room.pipeline._calm_since = 0.0
    return room, now


def statuses(room):
    return [json.loads(sent.text)["level"] for sent in room.topic(CAPTION_STATUS_TOPIC)]


def test_a_room_that_falls_behind_sheds_load_step_by_step_and_tells_listeners():
    room, now = scripted_room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    steps = int(3 * SHED_UP_EVERY_S) + 2
    audio = ScriptedBacklog([4.0] * steps, now)

    async def run():
        await room.pipeline.run_speaker("user_1", "TR_mic", audio)
        await asyncio.sleep(0)  # let the status messages go out

    asyncio.run(run())
    assert room.pipeline.shed_level == 3
    assert statuses(room) == [1, 2, 3]
    assert room.topic(CAPTION_STATUS_TOPIC)[0].identities == ["user_1", "user_2"]
    stream = room.router.streams[0]
    assert stream.degraded == 3


def test_an_overflow_sheds_load_even_when_the_backlog_looks_small():
    room, now = scripted_room()
    room.pipeline.set_language("user_1", "fr")
    audio = ScriptedBacklog([0.1, 0.1, 0.1], now, overflow_at=[1])
    asyncio.run(room.pipeline.run_speaker("user_1", "TR_mic", audio))
    assert room.pipeline.shed_level == 1


def test_captions_come_back_after_the_room_stays_calm():
    room, now = scripted_room()
    room.pipeline.set_language("user_1", "fr")
    calm = int(SHED_DOWN_AFTER_S) + 2
    audio = ScriptedBacklog([4.0] + [0.0] * calm, now)
    asyncio.run(room.pipeline.run_speaker("user_1", "TR_mic", audio))
    assert room.pipeline.shed_level == 0


def test_at_the_last_level_finals_reach_everyone_as_originals_without_translation():
    room, _ = scripted_room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    room.pipeline.shed_level = 3
    room.speak("user_1", PHRASE_CHUNKS)
    assert room.engine.calls == []
    assert room.topic(TRANSLATION_TOPIC) == []
    readers = {identity for sent in room.topic(TRANSCRIPTION_TOPIC) for identity in sent.identities}
    assert "user_2" in readers


def test_someone_switching_captions_on_while_reduced_is_told():
    room, _ = scripted_room()
    room.pipeline.shed_level = 2

    async def run():
        room.pipeline.set_captions("user_9", True)
        await asyncio.sleep(0)

    asyncio.run(run())
    assert statuses(room) == [2]
    assert room.topic(CAPTION_STATUS_TOPIC)[0].identities == ["user_9"]
