import asyncio

import aiohttp

from mawiid_ai.agent.pipeline import Segment
from mawiid_ai.agent.uploader import MAX_BATCH, TranscriptUploader

ROOM = "00000000-0000-4000-8000-000000000001"


def segment(n: int, translations=None) -> Segment:
    return Segment(f"SG_{n}", "user_7", "fr-FR", f"phrase {n}", n * 1000, n * 1000 + 800, translations or {})


class FakeBackend:
    def __init__(self, statuses=()) -> None:
        self.statuses = list(statuses)
        self.bodies: list[dict] = []

    async def __call__(self, path: str, body: dict) -> int:
        assert path == "/transcript/internal"
        status = self.statuses.pop(0) if self.statuses else 200
        if status == 0:
            raise aiohttp.ClientConnectionError("down")
        self.bodies.append(body)
        return status


def test_segments_are_sent_in_the_backend_format():
    backend = FakeBackend()
    uploader = TranscriptUploader(ROOM, backend)
    uploader.add(segment(1, {"en-US": "phrase one"}), user_id=7)

    asyncio.run(uploader.flush())

    assert backend.bodies == [
        {
            "room_uid": ROOM,
            "segments": [
                {
                    "transcript_segment_id": "SG_1",
                    "user_id": 7,
                    "transcript_language": "fr-FR",
                    "transcript_text": "phrase 1",
                    "transcript_started_ms": 1000,
                    "transcript_ended_ms": 1800,
                    "translations": [{"translation_language": "en-US", "translation_text": "phrase one"}],
                }
            ],
        }
    ]


def test_segments_without_an_account_are_skipped():
    backend = FakeBackend()
    uploader = TranscriptUploader(ROOM, backend)
    uploader.add(segment(1), user_id=None)

    asyncio.run(uploader.flush())

    assert backend.bodies == []


def test_large_backlogs_go_in_several_batches():
    backend = FakeBackend()
    uploader = TranscriptUploader(ROOM, backend)
    for n in range(MAX_BATCH + 5):
        uploader.add(segment(n), user_id=7)

    asyncio.run(uploader.flush())

    assert [len(body["segments"]) for body in backend.bodies] == [MAX_BATCH, 5]


def test_batches_are_kept_while_the_backend_is_down():
    backend = FakeBackend(statuses=[0, 503])
    uploader = TranscriptUploader(ROOM, backend)
    uploader.add(segment(1), user_id=7)

    asyncio.run(uploader.flush())  # unreachable
    asyncio.run(uploader.flush())  # 503
    asyncio.run(uploader.flush())  # saved

    assert len(backend.bodies) == 2
    assert backend.bodies[-1]["segments"][0]["transcript_segment_id"] == "SG_1"
    asyncio.run(uploader.flush())
    assert len(backend.bodies) == 2


def test_refused_batches_are_dropped():
    backend = FakeBackend(statuses=[401])
    uploader = TranscriptUploader(ROOM, backend)
    uploader.add(segment(1), user_id=7)

    asyncio.run(uploader.flush())
    asyncio.run(uploader.flush())

    assert len(backend.bodies) == 1
