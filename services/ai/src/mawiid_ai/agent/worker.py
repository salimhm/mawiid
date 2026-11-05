"""LiveKit worker for live captions. It joins only the rooms the backend dispatches to it
(agent name mawiid-translator, when a host turns translation on) and leaves when the host
turns translation off again.

    python -m mawiid_ai.agent dev     # development: reloads on code changes
    python -m mawiid_ai.agent start   # production

Environment: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET; LIVEKIT_TRANSLATOR_AGENT
(default mawiid-translator, same as the backend); MAWIID_BACKEND_URL and INTERNAL_SERVICE_TOKEN
to save the transcript (captions work without them); MAWIID_STT_* and MAWIID_MT_* for the models.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
from collections.abc import AsyncIterator

import aiohttp
import numpy as np
from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, JobExecutorType

from mawiid_ai.agent.pipeline import LANGUAGE_ATTRIBUTE, SPOKEN_LANGUAGE_ATTRIBUTE, RoomPipeline, Segment
from mawiid_ai.agent.uploader import TranscriptUploader, http_post
from mawiid_ai.stt import SAMPLE_RATE, SttRouter, build_router
from mawiid_ai.translation import SubtitleTranslator, build_translator

log = logging.getLogger(__name__)

AGENT_NAME = os.environ.get("LIVEKIT_TRANSLATOR_AGENT") or "mawiid-translator"
USER_ID_ATTRIBUTE = "mawiid.user_id"
CHUNK_MS = 100  # audio handed to speech-to-text at once
SHUTDOWN_TIMEOUT_S = 10.0

_models_lock = threading.Lock()
_models: tuple[SttRouter, SubtitleTranslator | None] | None = None


def load_models() -> tuple[SttRouter, SubtitleTranslator | None]:
    """Loaded once per worker and shared by every room it serves."""
    global _models
    with _models_lock:
        if _models is None:
            router = build_router()
            try:
                translator = build_translator()
            except Exception as exc:
                log.warning("no translation model, captions stay in the spoken language: %s", exc)
                translator = None
            _models = router, translator
        return _models


def translation_enabled(metadata: str | None) -> bool:
    """The room metadata the backend writes (service_room.metadata)."""
    try:
        return json.loads(metadata or "{}").get("room_translation_enabled") is True
    except (ValueError, AttributeError):
        return False


def user_id_of(identity: str, attributes: dict[str, str]) -> int | None:
    value = attributes.get(USER_ID_ATTRIBUTE, "")
    if value.isdigit():
        return int(value)
    match = re.fullmatch(r"user_(\d+)", identity)  # backend lib_livekit_identity
    return int(match.group(1)) if match else None


def is_person(participant: rtc.Participant) -> bool:
    return participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT


async def audio_chunks(stream: rtc.AudioStream) -> AsyncIterator[np.ndarray]:
    async for event in stream:
        yield np.frombuffer(event.frame.data, dtype=np.int16).copy()


def make_uploader(room_uid: str, session: aiohttp.ClientSession) -> TranscriptUploader | None:
    url = os.environ.get("MAWIID_BACKEND_URL")
    token = os.environ.get("INTERNAL_SERVICE_TOKEN")
    if not url or not token:
        log.warning("MAWIID_BACKEND_URL or INTERNAL_SERVICE_TOKEN is not set: the transcript is not saved")
        return None
    return TranscriptUploader(room_uid, http_post(url, token, session))


# Threads, not processes: every room shares the models loaded in this one process.
server = AgentServer(job_executor_type=JobExecutorType.THREAD)


@server.on("worker_started")
def _preload() -> None:
    # The first room should not wait for the models.
    threading.Thread(target=load_models, name="model-preload", daemon=True).start()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    router, translator = await asyncio.to_thread(load_models)
    room = ctx.room
    session = aiohttp.ClientSession()
    uploader = make_uploader(room.name, session)
    upload_loop: asyncio.Task[None] | None = None  # runs until cancelled, so it is not in tasks
    audio_streams: dict[str, rtc.AudioStream] = {}
    tasks: set[asyncio.Task[None]] = set()

    async def publish(text: str, topic: str, attributes: dict[str, str], identities: list[str] | None) -> None:
        await room.local_participant.send_text(
            text, topic=topic, attributes=attributes, destination_identities=identities
        )

    def on_segment(segment: Segment) -> None:
        if uploader is None:
            return
        participant = room.remote_participants.get(segment.identity)
        uploader.add(segment, user_id_of(segment.identity, participant.attributes if participant else {}))

    pipeline = RoomPipeline(router, translator, publish, on_segment)

    def spawn(coroutine) -> None:
        task = asyncio.create_task(coroutine)
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    def listen(publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        track = publication.track
        if (
            track is None
            or publication.sid in audio_streams
            or publication.source != rtc.TrackSource.SOURCE_MICROPHONE
            or not is_person(participant)
        ):
            return
        stream = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=1, frame_size_ms=CHUNK_MS)
        audio_streams[publication.sid] = stream
        spawn(pipeline.run_speaker(participant.identity, publication.sid, audio_chunks(stream)))

    def stop_listening(publication: rtc.RemoteTrackPublication) -> None:
        stream = audio_streams.pop(publication.sid, None)
        if stream is not None:
            spawn(stream.aclose())

    def follow(participant: rtc.RemoteParticipant) -> None:
        if is_person(participant):
            attributes = participant.attributes
            pipeline.set_language(
                participant.identity, attributes.get(LANGUAGE_ATTRIBUTE), attributes.get(SPOKEN_LANGUAGE_ATTRIBUTE)
            )

    @room.on("track_subscribed")
    def _on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        listen(publication, participant)

    @room.on("track_unsubscribed")
    def _on_track_unsubscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        stop_listening(publication)

    @room.on("participant_connected")
    def _on_participant_connected(participant: rtc.RemoteParticipant) -> None:
        follow(participant)

    @room.on("participant_attributes_changed")
    def _on_attributes_changed(changed: dict[str, str], participant: rtc.Participant) -> None:
        languages_changed = LANGUAGE_ATTRIBUTE in changed or SPOKEN_LANGUAGE_ATTRIBUTE in changed
        if languages_changed and isinstance(participant, rtc.RemoteParticipant):
            follow(participant)

    @room.on("participant_disconnected")
    def _on_participant_disconnected(participant: rtc.RemoteParticipant) -> None:
        pipeline.remove(participant.identity)

    @room.on("room_metadata_changed")
    def _on_metadata_changed(old_metadata: str, metadata: str) -> None:
        if not translation_enabled(metadata):
            ctx.shutdown("translation turned off")

    async def cleanup(reason: str) -> None:
        log.info("leaving %s: %s", room.name, reason)
        for stream in list(audio_streams.values()):
            await stream.aclose()  # ends each speaker loop, which flushes its last phrase
        audio_streams.clear()
        if tasks:
            await asyncio.wait(set(tasks), timeout=SHUTDOWN_TIMEOUT_S)
        if upload_loop is not None:
            upload_loop.cancel()
            await asyncio.gather(upload_loop, return_exceptions=True)
        if uploader is not None:
            await uploader.flush()
        await session.close()

    ctx.add_shutdown_callback(cleanup)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    if not translation_enabled(room.metadata):
        ctx.shutdown("translation is off in this room")
        return
    log.info("captioning %s (translation %s)", room.name, "on" if translator else "unavailable")
    for participant in room.remote_participants.values():
        follow(participant)
        for publication in participant.track_publications.values():
            listen(publication, participant)
    if uploader is not None:
        upload_loop = asyncio.create_task(uploader.run())
