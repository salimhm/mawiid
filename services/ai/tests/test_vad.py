import numpy as np

from mawiid_ai.stt.base import SAMPLE_RATE
from mawiid_ai.stt.config import VadSettings
from mawiid_ai.stt.vad import WINDOW, VadSegmenter


class ScriptedVad:
    """Speech probability comes from the audio itself: windows filled with 1.0 are speech."""

    def __call__(self, window: np.ndarray) -> float:
        return float(window.mean())

    def reset(self) -> None:
        pass


def audio(*parts: tuple[str, float]) -> np.ndarray:
    return np.concatenate(
        [np.full(int(seconds * SAMPLE_RATE), 1.0 if kind == "speech" else 0.0, dtype=np.float32) for kind, seconds in parts]
    )


def feed_in_chunks(segmenter: VadSegmenter, samples: np.ndarray, chunk: int = 320):
    segments = []
    for i in range(0, len(samples), chunk):
        segments += segmenter.feed(samples[i : i + chunk])
    return segments


def test_pause_splits_phrases():
    seg = VadSegmenter(VadSettings(), ScriptedVad())
    segments = feed_in_chunks(seg, audio(("silence", 1), ("speech", 2), ("silence", 1), ("speech", 1), ("silence", 1)))
    assert len(segments) == 2
    # Speech starts at 1.0 s; ~200 ms of pre-roll is kept so the first syllable isn't cut.
    assert 0.75 <= segments[0].start_sample / SAMPLE_RATE <= 0.85
    assert not segments[0].forced


def test_keeps_padding_but_trims_long_trailing_silence():
    settings = VadSettings(speech_pad_ms=200, min_silence_ms=500)
    seg = VadSegmenter(settings, ScriptedVad())
    [segment] = feed_in_chunks(seg, audio(("silence", 1), ("speech", 2), ("silence", 1)))
    trailing = segment.end_sample - (1 + 2) * SAMPLE_RATE
    assert 0 < trailing <= settings.speech_pad_ms * SAMPLE_RATE // 1000 + WINDOW


def test_short_blips_are_dropped():
    seg = VadSegmenter(VadSettings(min_speech_ms=250), ScriptedVad())
    assert feed_in_chunks(seg, audio(("silence", 1), ("speech", 0.1), ("silence", 1))) == []


def test_long_speech_is_cut_at_max_segment():
    seg = VadSegmenter(VadSettings(max_segment_s=5.0), ScriptedVad())
    segments = feed_in_chunks(seg, audio(("speech", 12), ("silence", 1)))
    assert [s.forced for s in segments] == [True, True, False]
    assert all(len(s.audio) <= 5 * SAMPLE_RATE for s in segments)


def test_flush_returns_unfinished_phrase():
    seg = VadSegmenter(VadSettings(), ScriptedVad())
    assert feed_in_chunks(seg, audio(("silence", 0.5), ("speech", 1))) == []
    assert seg.in_speech
    [segment] = seg.flush()
    assert len(segment.audio) >= SAMPLE_RATE
    assert not seg.in_speech


def test_a_cut_without_a_pause_repeats_the_end_of_the_chunk():
    seg = VadSegmenter(VadSettings(max_segment_s=5.0, overlap_ms=500), ScriptedVad())
    first, second, _ = feed_in_chunks(seg, audio(("speech", 12), ("silence", 1)))
    shared = first.end_sample - second.start_sample
    assert 0.45 * SAMPLE_RATE <= shared <= 0.5 * SAMPLE_RATE
    assert np.array_equal(first.audio[-shared:], second.audio[:shared])


def test_overlap_can_be_switched_off():
    seg = VadSegmenter(VadSettings(max_segment_s=5.0, overlap_ms=0), ScriptedVad())
    first, second, _ = feed_in_chunks(seg, audio(("speech", 12), ("silence", 1)))
    assert first.end_sample == second.start_sample


def test_the_overlap_alone_does_not_make_a_chunk():
    seg = VadSegmenter(VadSettings(max_segment_s=5.0, overlap_ms=500), ScriptedVad())
    segments = feed_in_chunks(seg, audio(("speech", 4.99), ("silence", 3)))
    assert len(segments) == 1


def test_speech_right_after_a_pause_keeps_the_audio_before_it():
    settings = VadSettings(min_silence_ms=500, speech_pad_ms=200)
    seg = VadSegmenter(settings, ScriptedVad())
    # The second phrase starts as soon as the first one closes.
    first, second = feed_in_chunks(seg, audio(("speech", 1), ("silence", 0.52), ("speech", 1), ("silence", 1)))
    assert second.start_sample < int(1.52 * SAMPLE_RATE) - WINDOW
    assert second.start_sample < first.start_sample + len(first.audio) + 200 * SAMPLE_RATE // 1000


def test_flush_does_not_carry_audio_into_what_comes_next():
    seg = VadSegmenter(VadSettings(), ScriptedVad())
    feed_in_chunks(seg, audio(("speech", 1)))
    seg.flush()
    flushed_at = seg.samples_seen
    assert feed_in_chunks(seg, audio(("speech", 1), ("silence", 1)))[0].start_sample == flushed_at
