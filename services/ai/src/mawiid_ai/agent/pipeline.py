"""Live captions for one room: each speaker's audio goes through speech-to-text, and each
phrase is translated once per language the listeners picked.

Speakers on "auto" (the default) have the language of each phrase detected, starting from the
language they read; a speaker who picked a language is always transcribed in it. Every result
carries its own language. Listeners who read that language get the transcript. The others get only translations:
- while someone talks, the words two partial transcripts in a row agree on are translated, so
  the subtitle grows with the speech without flickering;
- a final that ends mid-sentence (a pause, or the 6 s cut) stays open: the next phrase is
  translated together with it, as one growing subtitle, so the translator sees whole sentences.

Section 11 of docs/live-chat-plan.md. The LiveKit wiring lives in worker.py; this module only
needs a publish function, so the whole flow is tested with fakes (tests/test_pipeline.py).
"""

from __future__ import annotations

import asyncio
import functools
import json
import logging
import time
import uuid
from collections.abc import AsyncIterable, Awaitable, Callable
from concurrent.futures import Executor
from dataclasses import dataclass, replace

import numpy as np

from mawiid_ai.stt import LANGUAGES, ResultKind, SttRouter, SttStream, Transcript
from mawiid_ai.translation import SubtitleTranslator
from mawiid_ai.metrics import (
    caption_active_tracks,
    caption_degraded_rooms,
    caption_events,
    caption_processing_latency,
    caption_publish_duration,
    caption_shedding_changes,
    caption_transcription_duration,
    caption_translation_duration,
    caption_translation_queue_duration,
)

log = logging.getLogger(__name__)

# The topic and attributes LiveKit's own agents use, so LiveKit UI components can render them too.
TRANSCRIPTION_TOPIC = "lk.transcription"
TRANSLATION_TOPIC = "mawiid.translation.v1"
# {"level": 0..3, "reduced": bool}, sent to everyone with captions on when the room's caption
# quality changes to keep up with the load (see LoadShedder), and to whoever switches captions on.
CAPTION_STATUS_TOPIC = "mawiid.captions.status.v1"
SEGMENT_ATTRIBUTE = "lk.segment_id"
TRACK_ATTRIBUTE = "lk.transcribed_track_id"
FINAL_ATTRIBUTE = "lk.transcription_final"
LANGUAGE_ATTRIBUTE = "mawiid.language"  # the language someone reads captions in
TRANSLATION_ATTRIBUTE = "mawiid.translation_enabled"  # "true" when someone wants captions
SPOKEN_LANGUAGE_ATTRIBUTE = "mawiid.spoken_language"  # the language someone speaks, or AUTO
# With stage_timings on (MAWIID_STAGE_TIMINGS=1, for load tests), final captions also carry how
# long their phrase spent in each stage, in ms: the speech-to-text call that produced the last
# final, the wait behind the speaker's earlier translations, and the translation call itself.
STT_MS_ATTRIBUTE = "mawiid.timing.stt_ms"
QUEUE_MS_ATTRIBUTE = "mawiid.timing.queue_ms"
MT_MS_ATTRIBUTE = "mawiid.timing.mt_ms"
AUTO = "auto"  # detect the language of each phrase (also when no spoken language is set)

DEFAULT_LANGUAGE = "en-US"  # backend default for accounts without user_language
OPEN_RETRY_S = 5.0

# Load shedding, from the audio a room's speakers have waiting (agent/backlog.py). Each level
# keeps the previous ones: 1 no partial transcripts, 2 no Darija model, 3 originals only (no
# translation). Media is never touched; only caption quality goes down, and listeners are told.
SHED_MAX_LEVEL = 3
# A speaker this far behind (or audio dropped) raises the level. Not lower: one final decode
# alone can block a speaker ~1.5 s on CPU, which is normal.
SHED_UP_BACKLOG_S = 3.0
SHED_UP_EVERY_S = 5.0  # ...at most this often, so one level gets time to help
SHED_DOWN_BACKLOG_S = 0.5  # every speaker under this...
SHED_DOWN_AFTER_S = 30.0  # ...for this long lowers the level by one

# A live translation is sent once at least this many more words are stable.
MIN_NEW_WORDS = 2
# An open subtitle (its last final ends mid-sentence) is closed after this much silence...
HOLD_S = 1.5
# ...or once it is this long, for speech that never gets a full stop.
MAX_HELD_CHARS = 300
_SENTENCE_END = (".", "!", "?", "؟", "…", "。", "！", "？")
_CLOSING_MARKS = "\"'»”’)]"

# Accounts store short codes (user_language "fr"). Chinese script and Darija need the full
# code ("zh-TW", "ar-MA"); other regions fall back to the language ("en-GB" -> "en-US").
# Only languages switched on in LANGUAGES are returned.
_SHORT_CODES = {"en": "en-US", "fr": "fr-FR", "ar": "ar-SA", "zh": "zh-CN"}

# text, topic, attributes, destination identities (None: everyone in the room)
Publish = Callable[[str, str, dict[str, str], list[str] | None], Awaitable[None]]


def mawiid_language(code: str | None) -> str | None:
    """The Mawiid language code for an app language code, or None when no model handles it."""
    if not code:
        return None
    code = code.strip().lower()
    for known in LANGUAGES:
        if known.lower() == code:
            return known
    short = _SHORT_CODES.get(code.split("-")[0])
    return short if short in LANGUAGES else None


def ends_sentence(text: str) -> bool:
    return text.rstrip().rstrip(_CLOSING_MARKS).endswith(_SENTENCE_END)


def _no_spaces(language: str) -> bool:
    return language.startswith("zh")


def _words(text: str, language: str) -> list[str]:
    return list(text.replace(" ", "")) if _no_spaces(language) else text.split()


def _join(parts: list[str], language: str) -> str:
    return ("" if _no_spaces(language) else " ").join(part for part in parts if part)


def stable_words(previous: list[str], current: list[str]) -> list[str]:
    """The words two transcripts of the same growing phrase agree on, from the start."""
    count = 0
    for a, b in zip(previous, current):
        if a != b:
            break
        count += 1
    return current[:count]


@dataclass(frozen=True, slots=True)
class Segment:
    """A final phrase and its translations, as saved in the room transcript."""

    segment_id: str
    identity: str  # the speaker
    language: str
    text: str
    started_ms: int  # since the pipeline started
    ended_ms: int
    # Mawiid language -> text. Finals that ended mid-sentence are translated with the next one:
    # the translation is saved on the last of them and the earlier ones have none.
    translations: dict[str, str]


class _Speaker:
    def __init__(self, identity: str, track_sid: str) -> None:
        self.identity = identity
        self.track_sid = track_sid
        self.stream: SttStream | None = None
        self.language = ""
        self.detect = True
        self.offset = 0.0  # pipeline time when the stream started; stream timestamps count from here
        self.retry_at = 0.0
        self.segment_id: str | None = None  # shared by a phrase's partials and its final
        self.segment_language = ""  # the language the phrase's captions were sent in
        self.translating: asyncio.Task[None] | None = None  # translations run one after another
        self.version = 0  # bumped by every translation queued; older live ones are then skipped
        # Live translation of the phrase being spoken.
        self.previous_words: list[str] = []  # the last partial, to find the stable words
        self.translated_words = 0  # stable words of this phrase already translated
        # The subtitle listeners of other languages see. It stays open while its finals end mid-sentence.
        self.unit_id: str | None = None
        self.held = ""  # text of the open finals
        self.held_segments: list[tuple[str, Transcript]] = []  # saved when the subtitle closes
        self.unit_attributes: dict[str, str] = {}
        self.hold_timer: asyncio.Task[None] | None = None
        self.stt_s = 0.0  # duration of the last speech-to-text call that returned results
        self.backlog_s = 0.0  # audio waiting for this speaker's speech-to-text
        self.overflows = 0  # times its backlog overflowed and was dropped


class RoomPipeline:
    def __init__(
        self,
        router: SttRouter,
        translator: SubtitleTranslator | None,
        publish: Publish,
        on_segment: Callable[[Segment], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
        hold_s: float = HOLD_S,
        stage_timings: bool = False,
        executor: Executor | None = None,
        name: str = "",
    ) -> None:
        """Without a translator (no translation model on this machine), only the originals are sent.
        ``executor`` runs this room's speech-to-text calls (default: asyncio's shared pool). Give each
        speech-to-text model its own, so threads waiting on one model's lock never hold up another's."""
        self._router = router
        self._name = name or "room"  # for the log only
        self._executor = executor
        self._speakers: set[_Speaker] = set()
        self.shed_level = 0
        self._shed_changed_at = clock()
        self._calm_since = clock()
        self._hold_s = hold_s
        self._stage_timings = stage_timings
        self._translator = translator
        self._publish = publish
        self._on_segment = on_segment
        self._clock = clock
        self._started = clock()
        # Everyone in the room, by identity: the language they read.
        # None: a language no model handles, so they only get the originals.
        self._languages: dict[str, str | None] = {}
        # The language they speak, when they picked one. None: detected, starting from the one they read.
        self._spoken_languages: dict[str, str | None] = {}
        # Who switched captions on. Nobody: nothing is transcribed, sent or saved.
        self._captions: set[str] = set()

    def set_language(self, identity: str, code: str | None, spoken_code: str | None = None) -> None:
        """Record a participant's language attributes; a speaker's stream follows the spoken one."""
        language = mawiid_language(code)
        if language is None and code:
            log.warning("%s picked %r, which no model handles: originals only", identity, code)
        spoken = None if spoken_code == AUTO else mawiid_language(spoken_code)
        if spoken is None and spoken_code and spoken_code != AUTO:
            log.warning("%s speaks %r, which no model handles", identity, spoken_code)
        # A new language applies from the next phrase on: what was already shown is not re-sent.
        self._languages[identity] = language
        self._spoken_languages[identity] = spoken

    def set_captions(self, identity: str, enabled: bool) -> None:
        """Record a participant's own captions switch."""
        if enabled:
            if identity not in self._captions and self.shed_level:
                self._spawn_status([identity])  # they would otherwise read reduced captions unaware
            self._captions.add(identity)
        else:
            self._captions.discard(identity)

    def remove(self, identity: str) -> None:
        self._captions.discard(identity)
        self._languages.pop(identity, None)
        self._spoken_languages.pop(identity, None)

    def listeners(self) -> dict[str, list[str]]:
        """Identities with captions on, per Mawiid language."""
        groups: dict[str, list[str]] = {}
        for identity, language in self._languages.items():
            if language is not None and identity in self._captions:
                groups.setdefault(language, []).append(identity)
        return groups

    def _original_readers(self, spoken: str) -> list[str]:
        """Who gets the original text: everyone without a translation model; otherwise those who
        read the spoken language or a language no model handles."""
        if self._translator is None:
            return sorted(self._captions)
        return sorted(
            identity
            for identity in self._captions
            if self._languages.get(identity) in (None, spoken)
        )

    async def run_speaker(self, identity: str, track_sid: str, audio: AsyncIterable[np.ndarray | bytes]) -> None:
        """Transcribe one audio track (16 kHz mono chunks) until it ends."""
        speaker = _Speaker(identity, track_sid)
        self._speakers.add(speaker)
        caption_active_tracks.inc()
        try:
            async for chunk in audio:
                self._observe_backlog(speaker, audio)
                if not self._captions:
                    await self._close(speaker)
                    continue
                picked = self._spoken_languages.get(identity)
                language = picked or self._languages.get(identity) or DEFAULT_LANGUAGE
                detect = picked is None
                if speaker.stream is not None and (speaker.language, speaker.detect) != (language, detect):
                    await self._close(speaker)  # finish the current phrase in the old language
                if speaker.stream is None and not await self._open(speaker, language, detect):
                    continue
                await self._feed(speaker, lambda stream: stream.push_audio(chunk))
        finally:
            self._speakers.discard(speaker)
            await self._close(speaker)
            if speaker.translating is not None:
                await speaker.translating
            caption_active_tracks.dec()

    def close(self) -> None:
        """The room is done: stop counting it as degraded."""
        if self.shed_level:
            caption_degraded_rooms.dec()
            self.shed_level = 0

    # -- load shedding -----------------------------------------------------

    def _observe_backlog(self, speaker: _Speaker, audio: object) -> None:
        speaker.backlog_s = float(getattr(audio, "backlog_s", 0.0))
        overflows = int(getattr(audio, "overflows", 0))
        overflowed, speaker.overflows = overflows > speaker.overflows, overflows
        if overflowed:
            log.warning(
                "%s: %s fell %.0f s behind, its waiting audio was dropped (%.1f s dropped so far)",
                self._name, speaker.identity, float(getattr(audio, "max_backlog_s", 0.0)),
                float(getattr(audio, "dropped_s", 0.0)),
            )
        now = self._clock()
        worst = max(s.backlog_s for s in self._speakers)
        if worst > SHED_DOWN_BACKLOG_S or overflowed:
            self._calm_since = now
        if (overflowed or worst >= SHED_UP_BACKLOG_S) and self.shed_level < SHED_MAX_LEVEL:
            if now - self._shed_changed_at >= SHED_UP_EVERY_S or self.shed_level == 0:
                self._set_shed_level(self.shed_level + 1)
        elif (
            self.shed_level
            and now - self._calm_since >= SHED_DOWN_AFTER_S
            and now - self._shed_changed_at >= SHED_DOWN_AFTER_S
        ):
            self._set_shed_level(self.shed_level - 1)

    def _set_shed_level(self, level: int) -> None:
        previous, self.shed_level = self.shed_level, level
        self._shed_changed_at = self._clock()
        if previous == 0:
            caption_degraded_rooms.inc()
        elif level == 0:
            caption_degraded_rooms.dec()
        caption_shedding_changes.inc({"level": str(level)})
        worst = max((s.backlog_s for s in self._speakers), default=0.0)
        log.warning(
            "%s: captions %s to level %d to keep up with the load (worst speaker backlog %.1f s)",
            self._name, "reduced" if level > previous else "restored", level, worst,
        )
        for speaker in self._speakers:
            if speaker.stream is not None:
                speaker.stream.degrade(level)
        if self._captions:
            self._spawn_status(sorted(self._captions))

    def _spawn_status(self, identities: list[str]) -> None:
        text = json.dumps({"level": self.shed_level, "reduced": self.shed_level > 0})
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._publish_status(text, identities))

    async def _publish_status(self, text: str, identities: list[str]) -> None:
        try:
            await self._publish(text, CAPTION_STATUS_TOPIC, {}, identities)
        except Exception:
            log.exception("publishing the caption status failed")

    async def _stt(self, fn: Callable[..., object], *args: object):
        """Run a blocking speech-to-text call on this room's executor."""
        if self._executor is None:
            return await asyncio.to_thread(fn, *args)
        return await asyncio.get_running_loop().run_in_executor(self._executor, functools.partial(fn, *args))

    async def _open(self, speaker: _Speaker, language: str, detect: bool) -> bool:
        if self._clock() < speaker.retry_at:
            return False
        try:
            speaker.stream = await self._stt(self._router.open_stream, language, detect)
            if self.shed_level:
                speaker.stream.degrade(self.shed_level)
        except Exception:
            log.exception("could not open speech-to-text for %s (%s)", speaker.identity, language)
            speaker.retry_at = self._clock() + OPEN_RETRY_S
            return False
        speaker.language, speaker.detect = language, detect
        speaker.offset = self._clock() - self._started
        return True

    async def _close(self, speaker: _Speaker) -> None:
        stream, speaker.stream = speaker.stream, None
        if stream is not None:
            await self._feed(speaker, lambda _: stream.flush(), stream)
            try:
                await self._stt(stream.close)
            except Exception:
                log.exception("closing speech-to-text for %s failed", speaker.identity)
        self._close_unit(speaker)  # the speaker stopped or changed language: nothing more joins it

    async def _feed(
        self, speaker: _Speaker, op: Callable[[SttStream], list[Transcript]], stream: SttStream | None = None
    ) -> None:
        stream = stream or speaker.stream
        assert stream is not None
        started_at = self._clock()
        try:
            # Whisper blocks for a whole phrase; other speakers and the room keep running meanwhile.
            started = time.monotonic()
            results = await self._stt(op, stream)
            if results:
                speaker.stt_s = time.monotonic() - started
        except Exception:
            caption_transcription_duration.observe(
                self._clock() - started_at, {"engine": "unknown", "outcome": "error"}
            )
            caption_events.inc({"component": "transcription", "outcome": "error"})
            log.exception("speech-to-text failed for %s; reopening", speaker.identity)
            speaker.stream = None
            return
        engine = results[0].engine if results else "none"
        caption_transcription_duration.observe(
            self._clock() - started_at, {"engine": engine, "outcome": "success"}
        )
        caption_events.inc({"component": "transcription", "outcome": "success"})
        for result in results:
            await self._emit(speaker, result)

    async def _emit(self, speaker: _Speaker, result: Transcript) -> None:
        if not self._captions:
            return
        if speaker.segment_id is not None and speaker.segment_language != result.language:
            # The final heard another language than the partials: other people get it, so it starts
            # a caption of its own instead of replacing a partial they never saw.
            speaker.segment_id = None
        if speaker.held_segments and speaker.held_segments[-1][1].language != result.language:
            self._close_unit(speaker)  # the speaker switched language: a new subtitle starts
        if speaker.segment_id is None:
            speaker.segment_id = f"SG_{uuid.uuid4().hex[:12]}"
            speaker.segment_language = result.language
        segment_id = speaker.segment_id
        final = result.kind is ResultKind.FINAL
        if final:
            speaker.segment_id = None
        attributes = {
            SEGMENT_ATTRIBUTE: segment_id,
            TRACK_ATTRIBUTE: speaker.track_sid,
            FINAL_ATTRIBUTE: "true" if final else "false",
            LANGUAGE_ATTRIBUTE: result.language,
        }
        # People reading another language wait for their translation instead of the original.
        readers = self._original_readers(result.language)
        if readers:
            await self._send(
                result.text,
                TRANSCRIPTION_TOPIC,
                attributes,
                readers,
                result.kind,
                self._source_ended_at(speaker, result),
            )
        if speaker.unit_id is None:
            speaker.unit_id = segment_id
        if final:
            self._on_final(speaker, segment_id, result, attributes)
        else:
            self._on_partial(speaker, result)

    def _live_translation(self) -> bool:
        return self._translator is not None and self._translator.settings.partials

    def _on_partial(self, speaker: _Speaker, result: Transcript) -> None:
        self._cancel_hold(speaker)  # still talking: the coming final joins the open subtitle
        words = _words(result.text, result.language)
        stable = stable_words(speaker.previous_words, words)
        speaker.previous_words = words
        if not self._live_translation() or len(stable) - speaker.translated_words < MIN_NEW_WORDS:
            return
        speaker.translated_words = len(stable)
        text = _join([speaker.held, _join(stable, result.language)], result.language)
        self._queue(speaker, replace(result, text=text), self._unit_attributes(speaker, result))

    def _on_final(self, speaker: _Speaker, segment_id: str, result: Transcript, attributes: dict[str, str]) -> None:
        self._cancel_hold(speaker)
        speaker.previous_words, speaker.translated_words = [], 0
        speaker.held = _join([speaker.held, result.text], result.language)
        speaker.held_segments.append((segment_id, result))
        speaker.unit_attributes = self._unit_attributes(speaker, result)
        if self._translator is None or ends_sentence(speaker.held) or len(speaker.held) >= MAX_HELD_CHARS:
            self._close_unit(speaker)
            return
        # Mid-sentence: show what was said so far and wait for the rest.
        if self._live_translation():
            held = speaker.held_segments
            self._queue(
                speaker,
                Transcript(ResultKind.PARTIAL, speaker.held, result.language, held[0][1].start, result.end, result.engine),
                speaker.unit_attributes,
            )
        speaker.hold_timer = asyncio.create_task(self._close_after_hold(speaker))

    def _unit_attributes(self, speaker: _Speaker, result: Transcript) -> dict[str, str]:
        assert speaker.unit_id is not None
        return {
            SEGMENT_ATTRIBUTE: speaker.unit_id,
            TRACK_ATTRIBUTE: speaker.track_sid,
            LANGUAGE_ATTRIBUTE: result.language,
        }

    async def _close_after_hold(self, speaker: _Speaker) -> None:
        await asyncio.sleep(self._hold_s)
        speaker.hold_timer = None
        self._close_unit(speaker)

    def _cancel_hold(self, speaker: _Speaker) -> None:
        timer, speaker.hold_timer = speaker.hold_timer, None
        if timer is not None:
            timer.cancel()

    def _close_unit(self, speaker: _Speaker) -> None:
        """Send the final translation of the open subtitle and save its finals."""
        self._cancel_hold(speaker)
        segments, attributes = speaker.held_segments, speaker.unit_attributes
        text = speaker.held
        speaker.held, speaker.held_segments, speaker.unit_id, speaker.unit_attributes = "", [], None, {}
        speaker.previous_words, speaker.translated_words = [], 0
        if not segments:
            return
        first, last = segments[0][1], segments[-1][1]
        unit = Transcript(ResultKind.FINAL, text, last.language, first.start, last.end, last.engine)
        self._queue(speaker, unit, attributes, segments)

    def _queue(
        self,
        speaker: _Speaker,
        transcript: Transcript,
        attributes: dict[str, str],
        segments: list[tuple[str, Transcript]] | None = None,
    ) -> None:
        # Translation runs beside speech-to-text, chained so a speaker's subtitles stay in order.
        speaker.version += 1
        previous = speaker.translating
        if self._stage_timings and transcript.kind is ResultKind.FINAL:
            attributes = {**attributes, STT_MS_ATTRIBUTE: str(round(speaker.stt_s * 1000))}
        speaker.translating = asyncio.create_task(
            self._translate(previous, speaker, speaker.version, transcript, attributes, segments or [], time.monotonic())
        )

    async def _translate(
        self,
        previous: asyncio.Task[None] | None,
        speaker: _Speaker,
        version: int,
        transcript: Transcript,
        attributes: dict[str, str],
        segments: list[tuple[str, Transcript]],
        queued_at: float,
    ) -> None:
        if previous is not None:
            await previous
        caption_translation_queue_duration.observe(self._clock() - queued_at, {"kind": transcript.kind.value})
        live = transcript.kind is ResultKind.PARTIAL
        if live and version != speaker.version:
            caption_events.inc({"component": "translation", "outcome": "dropped"})
            return  # a newer subtitle is queued: skip this one rather than fall behind
        attributes = {**attributes, FINAL_ATTRIBUTE: "false" if live else "true"}
        timed = self._stage_timings and not live
        if timed:
            attributes[QUEUE_MS_ATTRIBUTE] = str(round((time.monotonic() - queued_at) * 1000))
        # Listeners of the spoken language read the original.
        groups = {language: ids for language, ids in self.listeners().items() if language != transcript.language}
        translations: dict[str, str] = {}
        if groups and self.shed_level >= SHED_MAX_LEVEL and self._translator is not None:
            # Shedding load: no translation, but the original beats nothing (finals only).
            if not live:
                readers = sorted(identity for ids in groups.values() for identity in ids)
                await self._send(
                    transcript.text, TRANSCRIPTION_TOPIC, attributes, readers,
                    transcript.kind, self._source_ended_at(speaker, transcript),
                )
        elif self._translator is not None and groups:
            started = time.monotonic()
            try:
                subtitles = await asyncio.to_thread(self._translator.translate, transcript, list(groups))
            except Exception:
                caption_translation_duration.observe(
                    time.monotonic() - started, {"engine": "unknown", "outcome": "error"}
                )
                caption_events.inc({"component": "translation", "outcome": "error"})
                log.exception("translation failed for %s", speaker.identity)
                subtitles = []
            if timed:
                attributes[MT_MS_ATTRIBUTE] = str(round((time.monotonic() - started) * 1000))
            missing = set(groups)
            for subtitle in subtitles:
                if subtitle.language not in groups:
                    continue
                missing.discard(subtitle.language)
                # zh-CN and zh-TW share a language but not a script: the text may come back
                # unchanged, and is still sent since these listeners did not get the original.
                if subtitle.text.strip() != transcript.text.strip():
                    translations[subtitle.language] = subtitle.text
                await self._send(
                    subtitle.text,
                    TRANSLATION_TOPIC,
                    {**attributes, LANGUAGE_ATTRIBUTE: subtitle.language},
                    groups[subtitle.language],
                    transcript.kind,
                    self._source_ended_at(speaker, transcript),
                )
            if missing and not live:
                # No translation came back: better the original than nothing.
                readers = sorted(identity for language in missing for identity in groups[language])
                await self._send(
                    transcript.text,
                    TRANSCRIPTION_TOPIC,
                    attributes,
                    readers,
                    transcript.kind,
                    self._source_ended_at(speaker, transcript),
                )
        if self._on_segment is not None:
            for i, (segment_id, result) in enumerate(segments):
                self._on_segment(
                    Segment(
                        segment_id=segment_id,
                        identity=speaker.identity,
                        language=result.language,
                        text=result.text,
                        started_ms=round((speaker.offset + result.start) * 1000),
                        ended_ms=round((speaker.offset + result.end) * 1000),
                        translations=translations if i == len(segments) - 1 else {},
                    )
                )

    def _source_ended_at(self, speaker: _Speaker, transcript: Transcript) -> float:
        return self._started + speaker.offset + transcript.end

    async def _send(
        self,
        text: str,
        topic: str,
        attributes: dict[str, str],
        identities: list[str] | None,
        kind: ResultKind,
        source_ended_at: float,
    ) -> None:
        started_at = self._clock()
        try:
            await self._publish(text, topic, attributes, identities)
        except Exception:
            caption_publish_duration.observe(self._clock() - started_at, {"topic": topic, "outcome": "error"})
            caption_events.inc({"component": "publish", "outcome": "error"})
            log.exception("publishing %s failed", topic)
            return
        caption_publish_duration.observe(self._clock() - started_at, {"topic": topic, "outcome": "success"})
        caption_processing_latency.observe(
            max(0.0, self._clock() - source_ended_at), {"kind": kind.value, "topic": topic}
        )
        caption_events.inc({"component": "publish", "outcome": "success"})
