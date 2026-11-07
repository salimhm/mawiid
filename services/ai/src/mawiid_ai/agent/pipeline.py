"""Live captions for one room: each speaker's audio goes through speech-to-text, and each
phrase is translated once per language the listeners picked.

Section 11 of docs/live-chat-plan.md. The LiveKit wiring lives in worker.py; this module only
needs a publish function, so the whole flow is tested with fakes (tests/test_pipeline.py).
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterable, Awaitable, Callable
from dataclasses import dataclass

import numpy as np

from mawiid_ai.stt import AUTO_LANGUAGE, LANGUAGES, ResultKind, SttRouter, SttStream, Transcript
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
SPOKEN_LANGUAGE_ATTRIBUTE = "mawiid.spoken_language"  # optional: skips detecting it from the voice (Darija needs it)

OPEN_RETRY_S = 5.0
LIVE_MIN_WORDS = 3  # a word or two alone translates badly: wait for a little context

# Accounts store short codes (user_language "fr"). Chinese script and Darija need the full
# code ("zh-TW", "ar-MA"); other regions fall back to the language ("en-GB" -> "en-US").
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
    return _SHORT_CODES.get(code.split("-")[0])


@dataclass(frozen=True, slots=True)
class Segment:
    """A final phrase and its translations, as saved in the room transcript."""

    segment_id: str
    identity: str  # the speaker
    language: str
    text: str
    started_ms: int  # since the pipeline started
    ended_ms: int
    translations: dict[str, str]  # Mawiid language -> text


class _Speaker:
    def __init__(self, identity: str, track_sid: str) -> None:
        self.identity = identity
        self.track_sid = track_sid
        self.stream: SttStream | None = None
        self.language = ""
        self.offset = 0.0  # pipeline time when the stream started; stream timestamps count from here
        self.retry_at = 0.0
        self.segment_id: str | None = None  # shared by a phrase's partials and its final
        self.translating: asyncio.Task[None] | None = None
        # The newest partial waiting for the translator; a newer one replaces it, so translation never queues up.
        self.waiting_partial: tuple[Transcript, dict[str, str]] | None = None


class RoomPipeline:
    def __init__(
        self,
        router: SttRouter,
        translator: SubtitleTranslator | None,
        publish: Publish,
        on_segment: Callable[[Segment], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Without a translator (no translation model on this machine), only the originals are sent."""
        self._router = router
        self._translator = translator
        self._publish = publish
        self._on_segment = on_segment
        self._clock = clock
        self._started = clock()
        # Everyone in the room, by identity: the language they read.
        # None: a language no model handles, so they only get the originals.
        self._languages: dict[str, str | None] = {}
        # The language they speak, when they set one; otherwise it is detected from their voice.
        self._spoken_languages: dict[str, str | None] = {}
        # Who switched captions on. Nobody: nothing is transcribed, sent or saved.
        self._captions: set[str] = set()

    def set_language(self, identity: str, code: str | None, spoken_code: str | None = None) -> None:
        """Record a participant's language attributes; a speaker's stream follows the spoken one."""
        language = mawiid_language(code)
        if language is None and code:
            log.warning("%s picked %r, which no model handles: originals only", identity, code)
        spoken = mawiid_language(spoken_code)
        if spoken is None and spoken_code:
            log.warning("%s speaks %r, which no model handles", identity, spoken_code)
        self._languages[identity] = language
        self._spoken_languages[identity] = spoken

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

    def listeners(self) -> dict[str, list[str]]:
        """Identities with captions on, per Mawiid language."""
        groups: dict[str, list[str]] = {}
        for identity, language in self._languages.items():
            if language is not None and identity in self._captions:
                groups.setdefault(language, []).append(identity)
        return groups

    async def run_speaker(self, identity: str, track_sid: str, audio: AsyncIterable[np.ndarray | bytes]) -> None:
        """Transcribe one audio track (16 kHz mono chunks) until it ends."""
        speaker = _Speaker(identity, track_sid)
        try:
            async for chunk in audio:
                if not self._captions:
                    await self._close(speaker)
                    continue
                language = self._spoken_languages.get(identity) or AUTO_LANGUAGE
                if speaker.stream is not None and speaker.language != language:
                    await self._close(speaker)  # finish the current phrase in the old language
                if speaker.stream is None and not await self._open(speaker, language):
                    continue
                await self._feed(speaker, lambda stream: stream.push_audio(chunk))
        finally:
            await self._close(speaker)
            while speaker.translating is not None and not speaker.translating.done():
                await speaker.translating

    async def _open(self, speaker: _Speaker, language: str) -> bool:
        if self._clock() < speaker.retry_at:
            return False
        try:
            speaker.stream = await asyncio.to_thread(self._router.open_stream, language)
        except Exception:
            log.exception("could not open speech-to-text for %s (%s)", speaker.identity, language)
            speaker.retry_at = self._clock() + OPEN_RETRY_S
            return False
        # Too short to detect, a first "bonjour" is more likely in the language they read than not.
        if read_language := self._languages.get(speaker.identity):
            speaker.stream.hint_language(read_language)
        speaker.language = language
        speaker.offset = self._clock() - self._started
        return True

    async def _close(self, speaker: _Speaker) -> None:
        stream, speaker.stream = speaker.stream, None
        if stream is None:
            return
        await self._feed(speaker, lambda _: stream.flush(), stream)
        try:
            await asyncio.to_thread(stream.close)
        except Exception:
            log.exception("closing speech-to-text for %s failed", speaker.identity)

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
        if speaker.segment_id is None:
            speaker.segment_id = f"SG_{uuid.uuid4().hex[:12]}"
        segment_id = speaker.segment_id
        final = result.kind is ResultKind.FINAL
        if final:
            speaker.segment_id = None
            # Compare with the translation lines below: words missing here were lost at speech-to-text.
            log.info("transcript %s %s %s: %s", segment_id, speaker.identity, result.language, result.text)
        attributes = {
            SEGMENT_ATTRIBUTE: segment_id,
            TRACK_ATTRIBUTE: speaker.track_sid,
            FINAL_ATTRIBUTE: "true" if final else "false",
            LANGUAGE_ATTRIBUTE: result.language,
        }
        await self._send(result.text, TRANSCRIPTION_TOPIC, attributes, sorted(self._captions))
        if final:
            speaker.waiting_partial = None  # the final says it all
            self._start_translation(speaker, result, attributes)
        elif self._translates_live(result):
            if speaker.translating is None or speaker.translating.done():
                self._start_translation(speaker, result, attributes)
            else:
                speaker.waiting_partial = (result, attributes)

    def _translates_live(self, result: Transcript) -> bool:
        if self._translator is None or not self._translator.settings.partials:
            return False
        # Characters for Chinese, which has no spaces.
        return len(result.text.split()) >= LIVE_MIN_WORDS or len(result.text) >= 3 * LIVE_MIN_WORDS

    def _start_translation(self, speaker: _Speaker, result: Transcript, attributes: dict[str, str]) -> None:
        # Translation runs beside speech-to-text, chained so a speaker's subtitles stay in order.
        previous = speaker.translating
        speaker.translating = asyncio.create_task(self._translate(previous, speaker, result, attributes))

    async def _translate(
        self,
        previous: asyncio.Task[None] | None,
        speaker: _Speaker,
        result: Transcript,
        attributes: dict[str, str],
    ) -> None:
        if previous is not None:
            await previous
        groups = self.listeners()
        translations: dict[str, str] = {}
        if self._translator is not None and groups:
            try:
                subtitles = await asyncio.to_thread(self._translator.translate, result, list(groups))
            except Exception:
                log.exception("translation failed for %s", speaker.identity)
                subtitles = []
            for subtitle in subtitles:
                # Listeners of the spoken language read the original. zh-CN and zh-TW share a
                # language but not a script, so the converted text is still sent.
                if subtitle.text.strip() == result.text.strip():
                    continue
                translations[subtitle.language] = subtitle.text
                if result.kind is ResultKind.FINAL:
                    log.info(
                        "translation %s %s->%s: %s",
                        attributes[SEGMENT_ATTRIBUTE], result.language, subtitle.language, subtitle.text,
                    )
                await self._send(
                    subtitle.text,
                    TRANSLATION_TOPIC,
                    {**attributes, LANGUAGE_ATTRIBUTE: subtitle.language},
                    groups[subtitle.language],
                )
        if result.kind is ResultKind.FINAL and self._on_segment is not None:
            self._on_segment(
                Segment(
                    segment_id=attributes[SEGMENT_ATTRIBUTE],
                    identity=speaker.identity,
                    language=result.language,
                    text=result.text,
                    started_ms=round((speaker.offset + result.start) * 1000),
                    ended_ms=round((speaker.offset + result.end) * 1000),
                    translations=translations,
                )
            )
        # Only the last task in the chain: a final may be waiting behind this one.
        if speaker.waiting_partial is not None and speaker.translating is asyncio.current_task():
            (waiting, waiting_attributes), speaker.waiting_partial = speaker.waiting_partial, None
            self._start_translation(speaker, waiting, waiting_attributes)

    async def _send(self, text: str, topic: str, attributes: dict[str, str], identities: list[str] | None) -> None:
        try:
            await self._publish(text, topic, attributes, identities)
        except Exception:
            log.exception("publishing %s failed", topic)
