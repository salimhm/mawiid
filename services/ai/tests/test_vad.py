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
