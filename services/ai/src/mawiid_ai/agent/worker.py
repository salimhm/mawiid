"""LiveKit worker for live captions. It joins only the rooms the backend dispatches to it
(agent name mawiid-translator, when a participant turns captions on) and stays until the
room ends, working only while someone has captions on.

    python -m mawiid_ai.agent dev     # development: reloads on code changes
    python -m mawiid_ai.agent start   # production

Environment: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET; LIVEKIT_TRANSLATOR_AGENT
(default mawiid-translator, same as the backend); MAWIID_BACKEND_URL and INTERNAL_SERVICE_TOKEN
to save the transcript (captions work without them); MAWIID_STT_* and MAWIID_MT_* for the models.

Capacity (docs: Mawiid — Live rooms collapse under 10 x 10 load):
- MAWIID_STT_INSTANCES: speech-to-text model copies in this process, each with its own lock,
  threads and executor; every room uses one, so a busy room only slows the rooms sharing its copy.
  0 (default): one per 4 cores on CPU (at most 4), one on GPU. The translation model is shared.
  Unless MAWIID_STT_WHISPER_CPU_THREADS is set, the cores are split between the copies.
- MAWIID_AGENT_MAX_ROOMS: rooms this worker accepts at once; LiveKit dispatches the rest to
  other workers (run more replicas) or waits. 0 (default): no limit.
- MAWIID_AGENT_MAX_BACKLOG_S: audio a speaker may have waiting before it is dropped (default 5).

MAWIID_LOG_FILE: also write the worker's log (INFO and up) to this file, rotated at 50 MB with
5 old files kept (make ai sets data/logs/worker.log). Unset: the terminal only.
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import logging.handlers
import os
import re
import threading
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor

import aiohttp
import numpy as np
from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, JobExecutorType

from mawiid_ai.agent.backlog import DEFAULT_MAX_BACKLOG_S, BoundedAudio
from mawiid_ai.agent.pipeline import (
    LANGUAGE_ATTRIBUTE,
    SPOKEN_LANGUAGE_ATTRIBUTE,
    TRANSLATION_ATTRIBUTE,
    RoomPipeline,
    Segment,
)
from mawiid_ai.agent.uploader import TranscriptUploader, http_post
from mawiid_ai.metrics import caption_active_rooms, start_metrics_server
from mawiid_ai.stt import SAMPLE_RATE, SttRouter, SttSettings, build_router
from mawiid_ai.translation import SubtitleTranslator, build_translator

log = logging.getLogger(__name__)

AGENT_NAME = os.environ.get("LIVEKIT_TRANSLATOR_AGENT") or "mawiid-translator"
USER_ID_ATTRIBUTE = "mawiid.user_id"
CHUNK_MS = 100  # audio handed to speech-to-text at once
SHUTDOWN_TIMEOUT_S = 10.0

MAX_ROOMS = int(os.environ.get("MAWIID_AGENT_MAX_ROOMS") or 0)
MAX_BACKLOG_S = float(os.environ.get("MAWIID_AGENT_MAX_BACKLOG_S") or DEFAULT_MAX_BACKLOG_S)
STT_EXECUTOR_THREADS = 8  # per model copy; only one decode per engine runs at a time anyway


class SttInstance:
    """One copy of the speech-to-text models with the threads that call it."""

    def __init__(self, index: int, router: SttRouter) -> None:
        self.router = router
        self.executor = ThreadPoolExecutor(STT_EXECUTOR_THREADS, thread_name_prefix=f"stt-{index}")
        self.rooms = 0


class Models:
    def __init__(self, stt: list[SttInstance], translator: SubtitleTranslator | None) -> None:
        self.stt = stt
        self.translator = translator
        self._lock = threading.Lock()

    def acquire(self) -> SttInstance:
        """The model copy serving the fewest rooms."""
        with self._lock:
            instance = min(self.stt, key=lambda i: i.rooms)
            instance.rooms += 1
            return instance

    def release(self, instance: SttInstance) -> None:
        with self._lock:
            instance.rooms = max(0, instance.rooms - 1)


_models_lock = threading.Lock()
_models: Models | None = None


def stt_plan(settings: SttSettings) -> tuple[int, SttSettings]:
    """How many model copies to load, and the settings each is built with."""
    from mawiid_ai.stt.whisper_engine import _resolve_device

    on_cpu = _resolve_device(settings.whisper)[0] == "cpu"
    cores = os.cpu_count() or 4
    count = int(os.environ.get("MAWIID_STT_INSTANCES") or 0)
    if count <= 0:
        count = min(4, max(1, cores // 4)) if on_cpu else 1
    if on_cpu and settings.whisper.cpu_threads == 0:
        # Copies decoding at once must not oversubscribe the cores: copies x threads <= cores.
        threads = max(1, cores // count)
        settings = dataclasses.replace(
            settings,
            whisper=dataclasses.replace(settings.whisper, cpu_threads=threads),
            darija=dataclasses.replace(settings.darija, cpu_threads=settings.darija.cpu_threads or threads),
        )
    return count, settings


def load_models() -> Models:
    """Loaded once per worker; each room uses one speech-to-text copy, all share the translator."""
    global _models
    with _models_lock:
        if _models is None:
            count, settings = stt_plan(SttSettings())
            log.info("loading %d speech-to-text model cop%s (%d CPU threads each)",
                     count, "y" if count == 1 else "ies", settings.whisper.cpu_threads)
            stt = [SttInstance(i, build_router(settings)) for i in range(count)]
            try:
                translator = build_translator()
            except Exception as exc:
                log.warning("no translation model, captions stay in the spoken language: %s", exc)
                translator = None
            _models = Models(stt, translator)
        return _models


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


async def pump(stream: rtc.AudioStream, out: BoundedAudio) -> None:
    """Moves a speaker's audio into its bounded backlog as fast as LiveKit delivers it."""
    try:
        async for chunk in audio_chunks(stream):
            out.put(chunk)
    finally:
        out.end()


def make_uploader(room_uid: str, session: aiohttp.ClientSession) -> TranscriptUploader | None:
    url = os.environ.get("MAWIID_BACKEND_URL")
    token = os.environ.get("INTERNAL_SERVICE_TOKEN")
    if not url or not token:
        log.warning("MAWIID_BACKEND_URL or INTERNAL_SERVICE_TOKEN is not set: the transcript is not saved")
        return None
    return TranscriptUploader(room_uid, http_post(url, token, session))


def room_load(server: AgentServer) -> float:
    """1.0 once MAWIID_AGENT_MAX_ROOMS rooms are being captioned: LiveKit then dispatches elsewhere."""
    return len(server.active_jobs) / MAX_ROOMS


# Threads, not processes: rooms share the translation model (~3 GB) loaded in this one process.
# Speech-to-text is split between model copies instead (MAWIID_STT_INSTANCES).
server = AgentServer(
    job_executor_type=JobExecutorType.THREAD,
    **({"load_fnc": room_load, "load_threshold": 1.0} if MAX_ROOMS > 0 else {}),
)


LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s [%(threadName)s] %(message)s"
LOG_FILE_BYTES = 50 * 1024 * 1024
LOG_FILE_BACKUPS = 5


def start_log_file(path: str | None = None) -> logging.Handler | None:
    """Copy the worker's log into MAWIID_LOG_FILE, once per process. Added on the root logger after
    the LiveKit CLI has set up its own handlers, so the terminal keeps its output."""
    path = path if path is not None else os.environ.get("MAWIID_LOG_FILE", "")
    if not path:
        return None
    path = os.path.abspath(path)
    root = logging.getLogger()
    for handler in root.handlers:
        if isinstance(handler, logging.FileHandler) and handler.baseFilename == path:
            return handler  # dev mode reloads the code in the same process
    os.makedirs(os.path.dirname(path), exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(
        path, maxBytes=LOG_FILE_BYTES, backupCount=LOG_FILE_BACKUPS, encoding="utf-8"
    )
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    root.addHandler(handler)
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)
    log.info("worker pid %d logging to %s", os.getpid(), path)
    return handler


@server.on("worker_started")
def _preload() -> None:
    start_log_file()
    # The first room should not wait for the models.
    start_metrics_server()
    threading.Thread(target=load_models, name="model-preload", daemon=True).start()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    models = await asyncio.to_thread(load_models)
    instance = models.acquire()
    caption_active_rooms.inc()
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

    pipeline = RoomPipeline(
        instance.router, models.translator, publish, on_segment,
        stage_timings=os.environ.get("MAWIID_STAGE_TIMINGS") == "1",  # load tests only
        executor=instance.executor,
        name=room.name,
    )

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
        # The pump drains LiveKit's queue continuously; its capacity is only a backstop.
        capacity = int(2 * MAX_BACKLOG_S * 1000 / CHUNK_MS)
        stream = rtc.AudioStream(
            track, sample_rate=SAMPLE_RATE, num_channels=1, frame_size_ms=CHUNK_MS, capacity=capacity
        )
        audio_streams[publication.sid] = stream
        backlog = BoundedAudio(CHUNK_MS / 1000, MAX_BACKLOG_S)
        spawn(pump(stream, backlog))
        spawn(pipeline.run_speaker(participant.identity, publication.sid, backlog))

    def stop_listening(publication: rtc.RemoteTrackPublication) -> None:
        stream = audio_streams.pop(publication.sid, None)
        if stream is not None:
            spawn(stream.aclose())

    def follow(participant: rtc.RemoteParticipant) -> None:
        if is_person(participant):
            attributes = participant.attributes
            pipeline.set_captions(participant.identity, attributes.get(TRANSLATION_ATTRIBUTE) == "true")
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
        followed = {LANGUAGE_ATTRIBUTE, SPOKEN_LANGUAGE_ATTRIBUTE, TRANSLATION_ATTRIBUTE}
        if followed & changed.keys() and isinstance(participant, rtc.RemoteParticipant):
            follow(participant)

    @room.on("participant_disconnected")
    def _on_participant_disconnected(participant: rtc.RemoteParticipant) -> None:
        pipeline.remove(participant.identity)

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
        pipeline.close()
        models.release(instance)
        caption_active_rooms.dec()

    ctx.add_shutdown_callback(cleanup)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    log.info(
        "captioning %s (translation %s, speech-to-text copy %d of %d)",
        room.name, "on" if models.translator else "unavailable", models.stt.index(instance) + 1, len(models.stt),
    )
    for participant in room.remote_participants.values():
        follow(participant)
        for publication in participant.track_publications.values():
            listen(publication, participant)
    if uploader is not None:
        upload_loop = asyncio.create_task(uploader.run())
