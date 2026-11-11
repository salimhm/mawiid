import asyncio
import time
from dataclasses import dataclass

import numpy as np

from mawiid_ai.agent import pipeline
from mawiid_ai.agent.pipeline import (
    ends_sentence,
    stable_words,
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
from mawiid_ai.stt.config import ALL_LANGUAGES
from mawiid_ai.stt.base import SAMPLE_RATE, ResultKind, SttError, SttStream, Transcript
from mawiid_ai.translation.base import TranslationEngine
from mawiid_ai.translation.config import TranslationSettings
from mawiid_ai.translation.translator import SubtitleTranslator

CHUNK = SAMPLE_RATE // 10  # 100 ms, like the worker
PHRASE_CHUNKS = 4  # fake streams: a partial after 2 chunks, a final after 4


class FakeStream(SttStream):
    def __init__(self, router: "FakeRouter", language: str, detect: bool = True) -> None:
        self.router = router
        self.language = language
        self.detect = detect
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
        end = "." if self.router.punctuate and kind is ResultKind.FINAL else ""
        # The language speech-to-text detected: the scripted one for this phrase, else the stream's.
        phrase = self.phrases - (kind is ResultKind.FINAL)
        detected = self.router.detected.get((phrase, kind), self.router.detected.get(phrase, self.language))
        return Transcript(kind, f"{detected} {label} {self.phrases}{end}", detected, start, start + 0.4, "fake")


class FakeRouter:
    def __init__(self) -> None:
        self.streams: list[FakeStream] = []
        self.crash = False
        self.punctuate = False  # finals end with a full stop
        # Phrase index (or (index, kind)) -> the language detected for it.
        self.detected: dict = {}

    def open_stream(self, language: str, detect: bool = True) -> FakeStream:
        stream = FakeStream(self, language, detect)
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
    def __init__(self, translate: bool = True, partials: bool = False, router=None, hold_s: float = 60.0) -> None:
        self.router = router or FakeRouter()
        self.engine = FakeEngine()
        settings = TranslationSettings(engines=["fake"], partials=partials)
        self.translator = SubtitleTranslator({"fake": self.engine}, settings) if translate else None
        self.sent: list[Sent] = []
        self.segments: list[Segment] = []
        self.pipeline = RoomPipeline(
            self.router, self.translator, self.publish, self.segments.append, clock=lambda: 0.0, hold_s=hold_s
        )

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

    def speak(self, identity: str, chunks: int, track: str = "TR_mic", between=None, pause_after: int | None = None) -> None:
        async def audio():
            for i in range(chunks):
                if between is not None:
                    between(i)
                if i == pause_after:
                    await asyncio.sleep(0.05)  # silence longer than hold_s
                yield np.zeros(CHUNK, dtype=np.int16)

        asyncio.run(self.pipeline.run_speaker(identity, track, audio()))


def test_app_language_codes_map_to_model_languages():
    assert mawiid_language("fr") == "fr-FR"
    assert mawiid_language("en") == "en-US"
    assert mawiid_language("en-GB") == "en-US"
    assert mawiid_language("de") is None
    assert mawiid_language("") is None
    assert mawiid_language(None) is None


def test_languages_switched_off_map_to_what_is_on(monkeypatch):
    monkeypatch.setattr(pipeline, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ("en-US", "fr-FR", "ar-SA")})
    assert mawiid_language("ar-MA") == "ar-SA"  # Darija off: plain Arabic
    assert mawiid_language("zh-tw") is None  # Chinese off: originals only
    assert mawiid_language("zh") is None


def test_darija_is_its_own_language_when_enabled(monkeypatch):
    monkeypatch.setattr(pipeline, "LANGUAGES", {code: ALL_LANGUAGES[code] for code in ("en-US", "fr-FR", "ar-SA", "ar-MA")})
    assert mawiid_language("ar-MA") == "ar-MA"
    assert mawiid_language("ar") == "ar-SA"


def test_original_goes_only_to_readers_of_the_spoken_language_and_partial_and_final_share_a_segment():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    room.pipeline.set_language("user_3", "fr")
    room.pipeline.set_language("user_4", "de")  # no model: reads originals

    room.speak("user_1", PHRASE_CHUNKS, track="TR_abc")

    partial, final = room.topic(TRANSCRIPTION_TOPIC)
    assert partial.identities == final.identities == ["user_1", "user_3", "user_4"]
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
    room.router.punctuate = True
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")

    room.speak("user_1", PHRASE_CHUNKS * 2)

    assert [segment.text for segment in room.segments] == ["fr-FR final 1.", "fr-FR final 2."]
    first, second = room.segments
    assert first.identity == "user_1"
    assert first.language == "fr-FR"
    assert first.translations == {"en-US": "<en-US>fr-FR final 1."}
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

    assert room.topic(TRANSCRIPTION_TOPIC) == []  # user_2 reads English, user_1 speaks French
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
    room.pipeline.set_language("user_1", "en", "ar")
    room.pipeline.set_language("user_2", "fr")

    room.speak("user_1", 1)

    assert [stream.language for stream in room.router.streams] == ["ar-SA"]
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
    # The French phrase ends after user_1 switched to reading Arabic: they get its translation.
    texts = [sent.text for sent in room.sent]
    assert texts == ["<ar-SA>fr-FR flushed 1", "ar-SA partial 0", "ar-SA flushed 1"]


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



def test_foreign_listeners_get_the_final_original_when_translation_fails():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")

    def broken(*_):
        raise RuntimeError("model down")

    room.translator.translate = broken
    room.speak("user_1", PHRASE_CHUNKS)

    originals = room.topic(TRANSCRIPTION_TOPIC)
    assert [(sent.attributes[FINAL_ATTRIBUTE], sent.identities) for sent in originals] == [
        ("false", ["user_1"]),
        ("true", ["user_1"]),
        ("true", ["user_2"]),
    ]
    assert room.topic(TRANSLATION_TOPIC) == []


class ScriptedStream(SttStream):
    """Returns the scripted results one audio chunk after another; flush returns the rest."""

    def __init__(self, script: list[list[Transcript]]) -> None:
        self.script = list(script)
        self.closed = False

    def push_audio(self, audio):
        return self.script.pop(0) if self.script else []

    def flush(self):
        rest = [result for results in self.script for result in results]
        self.script = []
        return rest

    def close(self) -> None:
        self.closed = True


class ScriptedRouter:
    def __init__(self, *script: list[Transcript]) -> None:
        self.script = list(script)
        self.streams: list[ScriptedStream] = []

    def open_stream(self, language: str, detect: bool = True) -> ScriptedStream:
        stream = ScriptedStream(self.script)
        self.streams.append(stream)
        return stream


def partial(text: str) -> list[Transcript]:
    return [Transcript(ResultKind.PARTIAL, text, "fr-FR", 0.0, 1.0, "fake")]


def final(text: str, start: float = 0.0) -> list[Transcript]:
    return [Transcript(ResultKind.FINAL, text, "fr-FR", start, start + 1.0, "fake")]


def french_and_english_room(*script, partials=True, hold_s=60.0) -> Room:
    room = Room(partials=partials, router=ScriptedRouter(*script), hold_s=hold_s)
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    return room


def translations(room: Room) -> list[tuple[str, str]]:
    return [(sent.text, sent.attributes[FINAL_ATTRIBUTE]) for sent in room.topic(TRANSLATION_TOPIC)]


def test_listeners_of_other_languages_get_the_stable_words_translated_while_someone_talks():
    room = french_and_english_room(
        partial("Bonjour à"),
        partial("Bonjour à tous je"),  # "Bonjour à" stable
        partial("Bonjour à tous, je"),  # "tous," changed: still only "Bonjour à"
        partial("Bonjour à tous, je pense"),  # "Bonjour à tous, je" stable: 2 more words
        final("Bonjour à tous, je pense."),
    )
    room.speak("user_1", 5)

    assert translations(room) == [
        ("<en-US>Bonjour à", "false"),
        ("<en-US>Bonjour à tous, je", "false"),
        ("<en-US>Bonjour à tous, je pense.", "true"),
    ]
    # One subtitle: every translation of the phrase shares the segment of its original.
    [segment] = {sent.attributes[SEGMENT_ATTRIBUTE] for sent in room.sent}
    assert segment.startswith("SG_")


def test_live_translation_can_be_switched_off():
    room = french_and_english_room(
        partial("Bonjour à"), partial("Bonjour à tous je"), final("Bonjour à tous."), partials=False
    )
    room.speak("user_1", 3)
    assert translations(room) == [("<en-US>Bonjour à tous.", "true")]


def test_a_final_ending_mid_sentence_is_translated_with_the_next_one_as_one_subtitle():
    room = french_and_english_room(final("Je pense que"), final("c'est une bonne idée.", start=1.0), partials=False)
    room.speak("user_1", 2)

    assert room.engine.calls == [("Je pense que c'est une bonne idée.", ["en-US"])]
    first, second = room.segments
    assert (first.text, first.translations) == ("Je pense que", {})
    assert (second.text, second.translations) == ("c'est une bonne idée.", {"en-US": "<en-US>Je pense que c'est une bonne idée."})
    [translation] = room.topic(TRANSLATION_TOPIC)
    assert translation.attributes[SEGMENT_ATTRIBUTE] == first.segment_id
    # French listeners still get each phrase as it is transcribed.
    assert [sent.text for sent in room.topic(TRANSCRIPTION_TOPIC)] == ["Je pense que", "c'est une bonne idée."]


def test_an_open_subtitle_shows_what_was_said_so_far_then_grows():
    room = french_and_english_room(final("Je pense que"), partial("c'est une"), partial("c'est une bonne"), final("c'est une bonne idée."))
    room.speak("user_1", 4)

    assert translations(room) == [
        ("<en-US>Je pense que", "false"),
        ("<en-US>Je pense que c'est une", "false"),
        ("<en-US>Je pense que c'est une bonne idée.", "true"),
    ]
    assert len({sent.attributes[SEGMENT_ATTRIBUTE] for sent in room.topic(TRANSLATION_TOPIC)}) == 1


def test_an_open_subtitle_is_closed_after_a_silence():
    room = french_and_english_room(final("Je pense que"), [], final("Autre chose."), partials=False, hold_s=0.01)
    room.speak("user_1", 3, pause_after=1)

    assert [text for text, _ in room.engine.calls] == ["Je pense que", "Autre chose."]
    first, second = room.topic(TRANSLATION_TOPIC)
    assert first.attributes[SEGMENT_ATTRIBUTE] != second.attributes[SEGMENT_ATTRIBUTE]


def test_an_open_subtitle_is_closed_when_it_gets_too_long():
    long = "mot " * 80
    room = french_and_english_room(final(long.strip()), final("fin."), partials=False)
    room.speak("user_1", 2)
    assert [text for text, _ in room.engine.calls] == [long.strip(), "fin."]


def test_stable_words_are_the_common_start_of_two_partials():
    assert stable_words([], ["a", "b"]) == []
    assert stable_words(["a", "b", "c"], ["a", "b", "d", "e"]) == ["a", "b"]
    assert stable_words(["a", "b"], ["a", "b", "c"]) == ["a", "b"]


def test_sentence_ends_are_recognised():
    assert ends_sentence("Bonjour.") and ends_sentence("Vraiment ?") and ends_sentence("هل أنت هنا؟")
    assert ends_sentence('Il a dit "oui."') and ends_sentence("Bon…")
    assert not ends_sentence("Je pense que") and not ends_sentence("Alors,")


class SlowEngine(FakeEngine):
    def translate(self, text, source, targets):
        time.sleep(0.05)  # longer than the partials take to arrive
        return super().translate(text, source, targets)


def test_queued_live_translations_are_skipped_when_newer_ones_arrive():
    room = french_and_english_room(
        partial("un"),
        partial("un deux trois"),
        partial("un deux trois quatre cinq"),
        partial("un deux trois quatre cinq six sept"),
        partial("un deux trois quatre cinq six sept huit"),
        final("un deux trois quatre cinq six sept huit."),
    )
    room.engine = room.translator.engines["fake"] = SlowEngine()
    room.speak("user_1", 6)

    sent = translations(room)
    assert sent[-1] == ("<en-US>un deux trois quatre cinq six sept huit.", "true")
    assert len(sent) < 4  # 3 live ones were queued; the stale ones were dropped


def test_each_phrase_is_captioned_in_the_language_it_was_spoken_in():
    room = Room()
    room.pipeline.set_language("user_1", "fr")  # picked French, speaks Arabic then English
    room.pipeline.set_language("user_2", "ar")
    room.pipeline.set_language("user_3", "en")
    room.router.detected = {0: "ar-SA", 1: "en-US"}
    room.router.punctuate = True

    room.speak("user_1", 2 * PHRASE_CHUNKS)

    originals = [(sent.text, sent.identities) for sent in room.topic(TRANSCRIPTION_TOPIC) if sent.attributes[FINAL_ATTRIBUTE] == "true"]
    assert originals == [("ar-SA final 1.", ["user_2"]), ("en-US final 2.", ["user_3"])]
    translations = [(sent.attributes[LANGUAGE_ATTRIBUTE], sent.identities) for sent in room.topic(TRANSLATION_TOPIC)]
    assert translations == [("fr-FR", ["user_1"]), ("en-US", ["user_3"]), ("fr-FR", ["user_1"]), ("ar-SA", ["user_2"])]
    assert [segment.language for segment in room.segments] == ["ar-SA", "en-US"]


def test_a_language_switch_closes_the_open_subtitle():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "en")
    room.router.detected = {1: "ar-SA"}  # no full stop: the French phrase would wait for the next one

    room.speak("user_1", 2 * PHRASE_CHUNKS)

    assert room.engine.calls == [("fr-FR final 1", ["en-US"]), ("ar-SA final 2", ["fr-FR", "en-US"])]


def test_a_final_in_another_language_than_its_partials_starts_a_new_caption():
    room = Room()
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "ar")
    room.router.detected = {(0, ResultKind.FINAL): "ar-SA"}  # the partial still guessed French

    room.speak("user_1", PHRASE_CHUNKS)

    partial, final = room.topic(TRANSCRIPTION_TOPIC)
    assert (partial.identities, final.identities) == (["user_1"], ["user_2"])
    assert partial.attributes[SEGMENT_ATTRIBUTE] != final.attributes[SEGMENT_ATTRIBUTE]


def test_auto_detects_from_the_read_language_and_a_picked_language_is_fixed():
    room = Room()
    room.pipeline.set_language("user_1", "fr")  # nothing picked: auto
    room.pipeline.set_language("user_2", "en", "auto")
    room.pipeline.set_language("user_3", "en", "ar")

    for identity in ("user_1", "user_2", "user_3"):
        room.speak(identity, 1)

    assert [(s.language, s.detect) for s in room.router.streams] == [
        ("fr-FR", True), ("en-US", True), ("ar-SA", False)
    ]


def test_switching_between_auto_and_a_picked_language_reopens_the_stream():
    room = Room()
    room.pipeline.set_language("user_1", "fr", "fr")

    def switch(chunk: int) -> None:
        if chunk == 1:
            room.pipeline.set_language("user_1", "fr", "auto")

    room.speak("user_1", 3, between=switch)

    assert [(s.language, s.detect) for s in room.router.streams] == [("fr-FR", False), ("fr-FR", True)]


def _switch(room: Room, identity: str, code: str) -> None:
    """Change someone's language inside an event loop, as the worker does, and wait for the re-send."""

    async def run():
        room.pipeline.set_language(identity, code)
        await asyncio.gather(*room.pipeline._resending.values())

    asyncio.run(run())


def test_changing_language_resends_recent_subtitles_in_the_new_language():
    room = Room()
    room.router.punctuate = True  # each final closes its subtitle
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "ar")
    room.speak("user_1", PHRASE_CHUNKS * 2)
    unit_ids = [sent.attributes[SEGMENT_ATTRIBUTE] for sent in room.topic(TRANSLATION_TOPIC)]
    room.sent.clear()

    _switch(room, "user_2", "en")

    assert [(s.text, s.topic, s.identities, s.attributes[LANGUAGE_ATTRIBUTE]) for s in room.sent] == [
        ("<en-US>fr-FR final 1.", TRANSLATION_TOPIC, ["user_2"], "en-US"),
        ("<en-US>fr-FR final 2.", TRANSLATION_TOPIC, ["user_2"], "en-US"),
    ]
    # Same subtitle ids, in order, all final: the new text replaces the old one.
    assert [s.attributes[SEGMENT_ATTRIBUTE] for s in room.sent] == unit_ids
    assert all(s.attributes[FINAL_ATTRIBUTE] == "true" for s in room.sent)


def test_changing_to_the_spoken_language_resends_the_original():
    room = Room()
    room.router.punctuate = True
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "ar")
    room.speak("user_1", PHRASE_CHUNKS)
    room.sent.clear()

    _switch(room, "user_2", "fr")

    assert [(s.text, s.topic, s.attributes[LANGUAGE_ATTRIBUTE]) for s in room.sent] == [
        ("fr-FR final 1.", TRANSCRIPTION_TOPIC, "fr-FR")
    ]


def test_nothing_is_resent_when_the_language_does_not_change_or_captions_are_off():
    room = Room()
    room.router.punctuate = True
    room.pipeline.set_language("user_1", "fr")
    room.pipeline.set_language("user_2", "ar")
    room.speak("user_1", PHRASE_CHUNKS)
    room.sent.clear()

    _switch(room, "user_2", "ar")
    room.pipeline.set_captions("user_2", False)

    async def captions_off_switch():
        RoomPipeline.set_language(room.pipeline, "user_2", "en")  # without turning captions on

    asyncio.run(captions_off_switch())
    assert room.sent == []
