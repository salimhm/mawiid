import pytest

from mawiid_ai.translation.madlad_engine import split_sentences


@pytest.mark.parametrize(
    ("text", "sentences"),
    [
        ("He arrived late. She had already left.", ["He arrived late.", "She had already left."]),
        ("Vous m'entendez ? Oui, très bien !", ["Vous m'entendez ?", "Oui, très bien !"]),
        ("هل تسمعني؟ نعم.", ["هل تسمعني؟", "نعم."]),
        ("他来了。她已经走了。", ["他来了。", "她已经走了。"]),
        ("One sentence only", ["One sentence only"]),
    ],
)
def test_a_final_is_split_into_sentences(text, sentences):
    assert split_sentences(text) == sentences


@pytest.mark.parametrize("text", ["Dr. Smith joined the U.S. Army in 1990.", "Mr. Lee met St. Peter's choir."])
def test_abbreviations_do_not_end_a_sentence(text):
    assert split_sentences(text) == [text]
