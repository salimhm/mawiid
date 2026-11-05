import asyncio
from dataclasses import dataclass

import numpy as np

from mawiid_ai.agent.pipeline import (
    FINAL_ATTRIBUTE,
    LANGUAGE_ATTRIBUTE,
    SEGMENT_ATTRIBUTE,
    TRACK_ATTRIBUTE,
    TRANSCRIPTION_TOPIC,
    TRANSLATION_TOPIC,
    RoomPipeline,
    Segment,
    mawiid_language,
)
from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind, SttError, SttStream, Transcript
from mawiid_ai.translation.base import TranslationEngine
from mawiid_ai.translation.config import TranslationSettings
from mawiid_ai.translation.translator import SubtitleTranslator

CHUNK = SAMPLE_RATE // 10  # 100 ms, like the worker
PHRASE_CHUNKS = 4  # fake streams: a partial after 2 chunks, a final after 4


class FakeStream(SttStream):
    def __init__(self, router: "FakeRouter", language: str) -> None:
        self.router = router
        self.language = language
        self.chunks = 0
        self.phrases = 0
        self.closed = False

    def push_audio(self, audio):
        if self.router.crash:
            raise SttError("crashed")
        self.chunks += 1
        if self.chunks == PHRASE_CHUNKS // 2:
            return [self._result(ResultKind.PARTIAL, "partial")]
        if self.chunks == PHRASE_CHUNKS:
            self.chunks = 0
            self.phrases += 1
            return [self._result(ResultKind.FINAL, "final")]
        return []

    def flush(self):
        if not self.chunks:
            return []
        self.chunks = 0
        self.phrases += 1
        return [self._result(ResultKind.FINAL, "flushed")]

    def close(self) -> None:
        self.closed = True

    def _result(self, kind: ResultKind, label: str) -> Transcript:
        start = self.phrases * PHRASE_CHUNKS * 0.1
        return Transcript(kind, f"{self.language} {label} {self.phrases}", self.language, start, start + 0.4, "fake")


class FakeRouter:
    def __init__(self) -> None:
        self.streams: list[FakeStream] = []
        self.crash = False

    def open_stream(self, language: str) -> FakeStream:
        stream = FakeStream(self, language)
        self.streams.append(stream)
        return stream


class FakeEngine(TranslationEngine):
    name = "fake"

    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []

    def supports(self, source: str, target: str) -> bool:
        return True

    def translate(self, text: str, source: str, targets: list[str]) -> list[str]:
        self.calls.append((text, list(targets)))
        return [f"<{target}>{text}" for target in targets]


@dataclass
class Sent:
    text: str
    topic: str
    attributes: dict[str, str]
    identities: list[str] | None


class Room:
    def __init__(self, translate: bool = True, partials: bool = False) -> None:
        self.router = FakeRouter()
        self.engine = FakeEngine()
        settings = TranslationSettings(engines=["fake"], partials=partials)
        self.translator = SubtitleTranslator({"fake": self.engine}, settings) if translate else None
        self.sent: list[Sent] = []
        self.segments: list[Segment] = []
        self.pipeline = RoomPipeline(self.router, self.translator, self.publish, self.segments.append, clock=lambda: 0.0)

        # Everyone has captions on unless a test says otherwise.
        set_language = self.pipeline.set_language

        def set_language_with_captions(identity, *codes):
            set_language(identity, *codes)
            self.pipeline.set_captions(identity, True)

        self.pipeline.set_language = set_language_with_captions

    async def publish(self, text, topic, attributes, identities):
        self.sent.append(Sent(text, topic, attributes, identities))

    def topic(self, topic: str) -> list[Sent]:
        return [sent for sent in self.sent if sent.topic == topic]

    def speak(self, identity: str, chunks: int, track: str = "TR_mic", between=None) -> None:
        async def audio():
            for i in range(chunks):
                if between is not None:
                    between(i)
                yield np.zeros(CHUNK, dtype=np.int16)

        asyncio.run(self.pipeline.run_speaker(identity, track, audio()))


def test_app_language_codes_map_to_model_languages():
    assert mawiid_language("fr") == "fr-FR"
    assert mawiid_language("en") == "en-US"
    assert mawiid_language("en-GB") == "en-US"
    assert mawiid_language("zh-tw") == "zh-TW"
    assert mawiid_language("ar-MA") == "ar-MA"
    assert mawiid_language("de") is None
    assert mawiid_language("") is None
    assert mawiid_language(None) is None


def test_original_goes_to_everyone_with_captions_on_and_partial_and_final_share_a_segment():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")

    room.speak("user_1", PHRASE_CHUNKS, track="TR_abc")

    partial, final = room.topic(TRANSCRIPTION_TOPIC)
    assert partial.identities == final.identities == ["user_1", "user_2"]
    assert partial.attributes[FINAL_ATTRIBUTE] == "false"
    assert final.attributes[FINAL_ATTRIBUTE] == "true"
    assert partial.attributes[SEGMENT_ATTRIBUTE] == final.attributes[SEGMENT_ATTRIBUTE]
    assert final.attributes[TRACK_ATTRIBUTE] == "TR_abc"
    assert final.attributes[LANGUAGE_ATTRIBUTE] == "fr-FR"
    assert final.text == "fr-FR final 1"


def test_each_language_is_translated_once_and_sent_only_to_its_listeners():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    room.pipeline.set_language("user_3", "en-US")
    room.pipeline.set_language("user_4", "ar")

    room.speak("user_1", PHRASE_CHUNKS)

    assert room.engine.calls == [("fr-FR final 1", ["en-US", "ar-SA"])]
    final = room.topic(TRANSCRIPTION_TOPIC)[-1]
    by_language = {sent.attributes[LANGUAGE_ATTRIBUTE]: sent for sent in room.topic(TRANSLATION_TOPIC)}
    assert set(by_language) == {"en-US", "ar-SA"}  # French listeners read the original
    assert by_language["en-US"].identities == ["user_2", "user_3"]
    assert by_language["ar-SA"].identities == ["user_4"]
    assert by_language["en-US"].text == "<en-US>fr-FR final 1"
    assert by_language["en-US"].attributes[SEGMENT_ATTRIBUTE] == final.attributes[SEGMENT_ATTRIBUTE]
    assert by_language["en-US"].attributes[FINAL_ATTRIBUTE] == "true"


def test_partials_are_not_translated_unless_enabled():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    room.speak("user_1", PHRASE_CHUNKS // 2)
    assert [sent.attributes[FINAL_ATTRIBUTE] for sent in room.topic(TRANSCRIPTION_TOPIC)] == ["false", "true"]
    assert [sent.attributes[FINAL_ATTRIBUTE] for sent in room.topic(TRANSLATION_TOPIC)] == ["true"]
    assert [text for text, _ in room.engine.calls] == ["fr-FR flushed 1"]

    room = Room(partials=True)
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    room.speak("user_1", PHRASE_CHUNKS)
    assert [sent.attributes[FINAL_ATTRIBUTE] for sent in room.topic(TRANSLATION_TOPIC)] == ["false", "true"]


def test_final_segments_are_saved_with_their_translations():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")

    room.speak("user_1", PHRASE_CHUNKS * 2)

    assert [segment.text for segment in room.segments] == ["fr-FR final 1", "fr-FR final 2"]
    first, second = room.segments
    assert first.identity == "user_1"
    assert first.language == "fr-FR"
    assert first.translations == {"en-US": "<en-US>fr-FR final 1"}
    assert (first.started_ms, first.ended_ms) == (400, 800)
    assert first.segment_id != second.segment_id


def test_nothing_is_transcribed_sent_or_saved_while_nobody_has_captions_on():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_captions("user_1", False)

    room.speak("user_1", 3)

    assert room.router.streams == []
    assert room.sent == []
    assert room.segments == []


def test_captions_reach_only_the_people_who_switched_them_on():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    room.pipeline.set_language("user_3", "ar")
    room.pipeline.set_captions("user_1", False)
    room.pipeline.set_captions("user_3", False)

    room.speak("user_1", 3)

    assert {tuple(sent.identities) for sent in room.topic(TRANSCRIPTION_TOPIC)} == {("user_2",)}
    assert {tuple(sent.identities) for sent in room.topic(TRANSLATION_TOPIC)} == {("user_2",)}
    assert {sent.attributes["mawiid.language"] for sent in room.topic(TRANSLATION_TOPIC)} == {"en-US"}


def test_turning_captions_off_finishes_the_phrase_and_stops_transcribing():
    room = Room()
    room.pipeline.set_language("user_1", "fr")

    def switch(chunk: int) -> None:
        if chunk == 2:
            room.pipeline.set_captions("user_1", False)

    room.speak("user_1", 4, between=switch)

    [stream] = room.router.streams
    assert stream.closed


def test_speech_uses_the_spoken_language_and_captions_the_read_language():
    room = Room()
    room.pipeline.set_language("user_1", "en", "ar-MA")
    room.pipeline.set_language("user_2", "fr")

    room.speak("user_1", 1)

    assert [stream.language for stream in room.router.streams] == ["ar-MA"]
    assert room.pipeline.listeners() == {"en-US": ["user_1"], "fr-FR": ["user_2"]}


def test_speech_follows_the_read_language_until_a_spoken_language_is_set():
    room = Room()
    room.pipeline.set_language("user_1", "fr")

    room.speak("user_1", 1)

    assert [stream.language for stream in room.router.streams] == ["fr-FR"]


def test_changing_language_finishes_the_phrase_then_reopens_the_stream():
    room = Room()
    room.pipeline.set_language("user_1", "fr")

    def switch(chunk: int) -> None:
        if chunk == 1:
            room.pipeline.set_language("user_1", "ar")

    room.speak("user_1", 3, between=switch)

    first, second = room.router.streams
    assert (first.language, second.language) == ("fr-FR", "ar-SA")
    assert first.closed and second.closed
    texts = [sent.text for sent in room.topic(TRANSCRIPTION_TOPIC)]
    assert texts == ["fr-FR flushed 1", "ar-SA partial 0", "ar-SA flushed 1"]


def test_without_a_translation_model_only_originals_are_sent():
    room = Room(translate=False)
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")

    room.speak("user_1", PHRASE_CHUNKS)

    assert room.topic(TRANSLATION_TOPIC) == []
    assert len(room.topic(TRANSCRIPTION_TOPIC)) == 2
    assert room.segments[0].translations == {}


def test_unsupported_languages_read_originals_and_speak_the_default():
    room = Room()
    room.pipeline.set_language("user_1", "de")
    room.pipeline.set_language("user_2", "fr")

    assert room.pipeline.listeners() == {"fr-FR": ["user_2"]}
    room.speak("user_1", PHRASE_CHUNKS)
    assert room.router.streams[0].language == "en-US"


def test_listeners_who_leave_stop_getting_translations():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    room.pipeline.remove("user_2")

    room.speak("user_1", PHRASE_CHUNKS)

    assert room.topic(TRANSLATION_TOPIC) == []


def test_a_crashed_stream_is_reopened_on_the_next_chunk():
    room = Room()
    room.pipeline.set_language("user_1", "fr")

    def crash_once(chunk: int) -> None:
        room.router.crash = chunk == 1

    room.speak("user_1", 3, between=crash_once)

    assert len(room.router.streams) == 2
