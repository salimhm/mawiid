"""Saves final segments in the room transcript: every few seconds, one batch goes to the
backend's internal API (POST /transcript/internal, docs/live-chat-plan.md section 8.4)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import aiohttp

from mawiid_ai.agent.pipeline import Segment

log = logging.getLogger(__name__)

INTERVAL_S = 5.0
MAX_BATCH = 100  # the backend accepts at most this many segments per request
MAX_PENDING = 2000  # backend down for a long time: the oldest segments are dropped beyond this
TIMEOUT_S = 10.0

# path, JSON body -> HTTP status
Post = Callable[[str, dict[str, Any]], Awaitable[int]]


class TranscriptUploader:
    def __init__(self, room_uid: str, post: Post, interval_s: float = INTERVAL_S) -> None:
        self.room_uid = room_uid
        self._post = post
        self._interval = interval_s
        self._pending: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()

    def add(self, segment: Segment, user_id: int | None) -> None:
        """Queue a final segment; segments without a known speaker account are not saved."""
        if user_id is None or not segment.text.strip():
            return
        self._pending.append(
            {
                "transcript_segment_id": segment.segment_id,
                "user_id": user_id,
                "transcript_language": segment.language,
                "transcript_text": segment.text,
                "transcript_started_ms": segment.started_ms,
                "transcript_ended_ms": max(segment.ended_ms, segment.started_ms),
                "translations": [
                    {"translation_language": language, "translation_text": text}
                    for language, text in segment.translations.items()
                ],
            }
        )
        if len(self._pending) > MAX_PENDING:
            dropped = len(self._pending) - MAX_PENDING
            del self._pending[:dropped]
            log.warning("transcript backlog full: dropped %d segments of room %s", dropped, self.room_uid)

    async def run(self) -> None:
        """Flush every interval until cancelled."""
        while True:
            await asyncio.sleep(self._interval)
            await self.flush()

    async def flush(self) -> None:
        async with self._lock:
            while self._pending:
                batch = self._pending[:MAX_BATCH]
                try:
                    status = await self._post(
                        "/transcript/internal", {"room_uid": self.room_uid, "segments": batch}
                    )
                except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                    log.warning("backend unreachable, transcript batch kept for later: %r", exc)
                    return
                if status >= 500 or status == 429:
                    log.warning("backend answered %d, transcript batch kept for later", status)
                    return
                if status >= 400:
                    # Bad token or rejected data: sending it again would fail the same way.
                    log.error("backend refused a transcript batch of room %s (%d), dropped", self.room_uid, status)
                del self._pending[: len(batch)]


def http_post(base_url: str, token: str, session: aiohttp.ClientSession) -> Post:
    async def post(path: str, body: dict[str, Any]) -> int:
        async with session.post(
            base_url.rstrip("/") + path,
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=aiohttp.ClientTimeout(total=TIMEOUT_S),
        ) as response:
            return response.status

    return post
