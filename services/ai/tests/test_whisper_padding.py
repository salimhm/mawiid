import numpy as np

from mawiid_ai.stt.whisper_engine import pad_to_phrase


def frames(count: int) -> np.ndarray:
    return np.ones((80, count), dtype=np.float32)


def test_short_phrases_are_padded_to_the_minimum():
    assert pad_to_phrase(frames(200)).shape == (80, 1000)


def test_longer_phrases_keep_all_their_audio_plus_silence():
    padded = pad_to_phrase(frames(1500))
    assert padded.shape == (80, 1800)
    assert padded[:, :1500].all()
    assert not padded[:, 1500:].any()


def test_length_never_exceeds_what_whisper_accepts():
    assert pad_to_phrase(frames(2900)).shape == (80, 3000)
    assert pad_to_phrase(frames(5000)).shape == (80, 3000)
