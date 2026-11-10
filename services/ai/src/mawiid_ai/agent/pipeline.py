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
import logging
import time
import uuid
from collections import deque
from collections.abc import AsyncIterable, Awaitable, Callable
from dataclasses import dataclass, replace

import numpy as np

from mawiid_ai.stt import LANGUAGES, ResultKind, SttRouter, SttStream, Transcript
from mawiid_ai.translation import SubtitleTranslator

log = logging.getLogger(__name__)

# The topic and attributes LiveKit's own agents use, so LiveKit UI components can render them too.
TRANSCRIPTION_TOPIC = "lk.transcription"
TRANSLATION_TOPIC = "mawiid.translation.v1"
SEGMENT_ATTRIBUTE = "lk.segment_id"
TRACK_ATTRIBUTE = "lk.transcribed_track_id"
FINAL_ATTRIBUTE = "lk.transcription_final"
LANGUAGE_ATTRIBUTE = "mawiid.language"  # the language someone reads captions in
TRANSLATION_ATTRIBUTE = "mawiid.translation_enabled"  # "true" when someone wants captions
SPOKEN_LANGUAGE_ATTRIBUTE = "mawiid.spoken_language"  # the language someone speaks, or AUTO
AUTO = "auto"  # detect the language of each phrase (also when no spoken language is set)

DEFAULT_LANGUAGE = "en-US"  # backend default for accounts without user_language
OPEN_RETRY_S = 5.0

# A live translation is sent once at least this many more words are stable.
MIN_NEW_WORDS = 2
# An open subtitle (its last final ends mid-sentence) is closed after this much silence...
HOLD_S = 1.5
# ...or once it is this long, for speech that never gets a full stop.
MAX_HELD_CHARS = 300
# Subtitles re-sent, in the new language, to someone who changes the language they read.
HISTORY_SUBTITLES = 8
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


@dataclass(frozen=True, slots=True)
class _Sent:
    """A closed subtitle, kept to re-send it to someone who changes their language."""

    unit_id: str
    track_sid: str
    transcript: Transcript


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


class RoomPipeline:
    def __init__(
        self,
        router: SttRouter,
        translator: SubtitleTranslator | None,
        publish: Publish,
        on_segment: Callable[[Segment], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
        hold_s: float = HOLD_S,
    ) -> None:
        """Without a translator (no translation model on this machine), only the originals are sent."""
        self._router = router
        self._hold_s = hold_s
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
        self._history: deque[_Sent] = deque(maxlen=HISTORY_SUBTITLES)
        self._resending: dict[str, asyncio.Task[None]] = {}

    def set_language(self, identity: str, code: str | None, spoken_code: str | None = None) -> None:
        """Record a participant's language attributes; a speaker's stream follows the spoken one."""
        language = mawiid_language(code)
        if language is None and code:
            log.warning("%s picked %r, which no model handles: originals only", identity, code)
        spoken = None if spoken_code == AUTO else mawiid_language(spoken_code)
        if spoken is None and spoken_code and spoken_code != AUTO:
            log.warning("%s speaks %r, which no model handles", identity, spoken_code)
        changed = identity in self._languages and self._languages[identity] != language
        self._languages[identity] = language
        self._spoken_languages[identity] = spoken
        if changed and language is not None and identity in self._captions and self._history:
            self._resend_history(identity, language)

    def _resend_history(self, identity: str, language: str) -> None:
        """Send the recent subtitles again in the language someone just picked: what they read
        so far would otherwise stay in the old language (and direction) on their screen."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # not in the worker's event loop (tests calling set_language directly)
        previous = self._resending.pop(identity, None)
        if previous is not None:
            previous.cancel()  # they changed again: only the latest language matters
        task = loop.create_task(self._send_history(identity, language, list(self._history)))
        self._resending[identity] = task
        task.add_done_callback(lambda done: self._resending.pop(identity, None) if self._resending.get(identity) is done else None)

    async def _send_history(self, identity: str, language: str, history: list[_Sent]) -> None:
        for sent in history:
            transcript = sent.transcript
            attributes = {
                SEGMENT_ATTRIBUTE: sent.unit_id,
                TRACK_ATTRIBUTE: sent.track_sid,
                FINAL_ATTRIBUTE: "true",
            }
            text, topic, shown = transcript.text, TRANSCRIPTION_TOPIC, transcript.language
            if self._translator is not None and transcript.language != language:
                try:
                    subtitles = await asyncio.to_thread(self._translator.translate, transcript, [language])
                except Exception:
                    log.exception("re-translating for %s failed", identity)
                    subtitles = []
                for subtitle in subtitles:
                    if subtitle.language == language:
                        text, topic, shown = subtitle.text, TRANSLATION_TOPIC, language
            await self._send(text, topic, {**attributes, LANGUAGE_ATTRIBUTE: shown}, [identity])

    def set_captions(self, identity: str, enabled: bool) -> None:
        """Record a participant's own captions switch."""
        if enabled:
            self._captions.add(identity)
        else:
            self._captions.discard(identity)

    def remove(self, identity: str) -> None:
        self._captions.discard(identity)
        self._languages.pop(identity, None)
        self._spoken_languages.pop(identity, None)
        task = self._resending.pop(identity, None)
        if task is not None:
            task.cancel()

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
        try:
            async for chunk in audio:
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
            await self._close(speaker)
            if speaker.translating is not None:
                await speaker.translating

    async def _open(self, speaker: _Speaker, language: str, detect: bool) -> bool:
        if self._clock() < speaker.retry_at:
            return False
        try:
            speaker.stream = await asyncio.to_thread(self._router.open_stream, language, detect)
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
                await asyncio.to_thread(stream.close)
            except Exception:
                log.exception("closing speech-to-text for %s failed", speaker.identity)
        self._close_unit(speaker)  # the speaker stopped or changed language: nothing more joins it

    async def _feed(
        self, speaker: _Speaker, op: Callable[[SttStream], list[Transcript]], stream: SttStream | None = None
    ) -> None:
        stream = stream or speaker.stream
        assert stream is not None
        try:
            # Whisper blocks for a whole phrase; other speakers and the room keep running meanwhile.
            results = await asyncio.to_thread(op, stream)
        except Exception:
            log.exception("speech-to-text failed for %s; reopening", speaker.identity)
            speaker.stream = None
            return
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
            await self._send(result.text, TRANSCRIPTION_TOPIC, attributes, readers)
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
        self._history.append(_Sent(attributes[SEGMENT_ATTRIBUTE], speaker.track_sid, unit))
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
        speaker.translating = asyncio.create_task(
            self._translate(previous, speaker, speaker.version, transcript, attributes, segments or [])
        )

    async def _translate(
        self,
        previous: asyncio.Task[None] | None,
        speaker: _Speaker,
        version: int,
        transcript: Transcript,
        attributes: dict[str, str],
        segments: list[tuple[str, Transcript]],
    ) -> None:
        if previous is not None:
            await previous
        live = transcript.kind is ResultKind.PARTIAL
        if live and version != speaker.version:
            return  # a newer subtitle is queued: skip this one rather than fall behind
        attributes = {**attributes, FINAL_ATTRIBUTE: "false" if live else "true"}
        # Listeners of the spoken language read the original.
        groups = {language: ids for language, ids in self.listeners().items() if language != transcript.language}
        translations: dict[str, str] = {}
        if self._translator is not None and groups:
            try:
                subtitles = await asyncio.to_thread(self._translator.translate, transcript, list(groups))
            except Exception:
                log.exception("translation failed for %s", speaker.identity)
                subtitles = []
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
                )
            if missing and not live:
                # No translation came back: better the original than nothing.
                readers = sorted(identity for language in missing for identity in groups[language])
                await self._send(transcript.text, TRANSCRIPTION_TOPIC, attributes, readers)
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

    async def _send(self, text: str, topic: str, attributes: dict[str, str], identities: list[str] | None) -> None:
        try:
            await self._publish(text, topic, attributes, identities)
        except Exception:
            log.exception("publishing %s failed", topic)
