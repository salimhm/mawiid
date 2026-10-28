"""MADLAD-400 3B (Google, Apache 2.0) on CTranslate2: one model for every language pair.

Converted once with scripts/convert_translation_model.py (int8 weights, ~2.8 GB). Runs on a
GPU (int8 weights, bfloat16 activations: T5 models overflow in float16) or on CPU (int8).
The target language is a tag in front of the source text: "<2ar> Bonjour".

MADLAD translates sentence by sentence: given two sentences at once it sometimes drops one,
so each final is split into sentences, all of them (for every target) go in one batch, and
the translations are joined again.
"""

from __future__ import annotations

import logging
import re
import threading
from pathlib import Path

from mawiid_ai.stt.config import LANGUAGES
from mawiid_ai.translation.base import TranslationEngine
from mawiid_ai.translation.config import MadladSettings

log = logging.getLogger(__name__)

# MADLAD occasionally loops ("1-2-1-1-1-..."); no translation is this much longer than its source.
_MAX_DECODING = 256
# A looping output is retried once with repeated 4-token sequences banned.
_NO_REPEAT_NGRAM = 4

_SENTENCE_END = re.compile(r"(?<=[.!?؟])\s+|(?<=[。！？])")
_ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "st", "jr", "sr", "prof", "vs", "no", "mt", "m", "mme", "mlle"}


def split_sentences(text: str) -> list[str]:
    """Split a transcript at sentence ends, keeping abbreviations such as "Dr." or "U.S." intact."""
    sentences, start = [], 0
    for end in _SENTENCE_END.finditer(text):
        words = text[start : end.start()].split()
        last = words[-1] if words else ""
        if last.endswith(".") and _is_abbreviation(last[:-1]):
            continue
        sentences.append(text[start : end.start()].strip())
        start = end.end()
    sentences.append(text[start:].strip())
    return [s for s in sentences if s]


def _is_abbreviation(word: str) -> bool:
    return len(word) <= 1 or "." in word or word.lower() in _ABBREVIATIONS


def encode(sp, text: str, target: str) -> list[str]:
    """Sentencepiece tokens for translating ``text`` into the Mawiid language ``target``."""
    return [*sp.encode(f"<2{LANGUAGES[target].model_code}> {text}", out_type=str), "</s>"]


def _resolve_device(settings: MadladSettings) -> tuple[str, str]:
    import ctranslate2

    device = settings.device
    if device == "auto":
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    compute_type = settings.compute_type
    if compute_type == "default":
        if device == "cpu":
            compute_type = "int8"
        elif "int8_bfloat16" in ctranslate2.get_supported_compute_types("cuda"):
            compute_type = "int8_bfloat16"
        else:  # pre-Ampere GPUs have no bfloat16
            compute_type = "int8_float32"
    return device, compute_type


class MadladEngine(TranslationEngine):
    def __init__(self, settings: MadladSettings, name: str = "madlad") -> None:
        import ctranslate2
        import sentencepiece

        self.name = name
        self.settings = settings
        path = Path(settings.model_path)
        if not (path / "model.bin").exists():
            raise FileNotFoundError(f"no translation model at {path}; run python scripts/convert_translation_model.py")
        self.device, self.compute_type = _resolve_device(settings)
        log.info("loading madlad from %s on %s (%s)", path, self.device, self.compute_type)
        self._translator = ctranslate2.Translator(
            str(path), device=self.device, compute_type=self.compute_type, intra_threads=settings.cpu_threads
        )
        self._sp = sentencepiece.SentencePieceProcessor(model_file=str(path / "spiece.model"))
        # CTranslate2 handles concurrent calls, but on CPU they just fight over cores.
        self._lock = threading.Lock() if self.device == "cpu" else None

    def supports(self, source: str, target: str) -> bool:
        return source in LANGUAGES and target in LANGUAGES

    def encode(self, text: str, target: str) -> list[str]:
        return encode(self._sp, text, target)

    def translate(self, text: str, source: str, targets: list[str]) -> list[str]:
        sentences = split_sentences(text)
        batch = [self.encode(sentence, target) for target in targets for sentence in sentences]
        if self._lock is not None:
            with self._lock:
                outputs = self._decode(batch)
        else:
            outputs = self._decode(batch)
        n = len(sentences)
        return [
            ("" if LANGUAGES[target].model_code == "zh" else " ").join(outputs[i * n : (i + 1) * n])
            for i, target in enumerate(targets)
        ]

    def _decode(self, batch: list[list[str]]) -> list[str]:
        limit = min(_MAX_DECODING, 2 * max(map(len, batch)) + 10)
        options = {"beam_size": self.settings.beam_size, "max_decoding_length": limit}
        hypotheses = [r.hypotheses[0] for r in self._translator.translate_batch(batch, **options)]
        looping = [i for i, tokens in enumerate(hypotheses) if len(tokens) >= limit]
        if looping:
            retried = self._translator.translate_batch(
                [batch[i] for i in looping], no_repeat_ngram_size=_NO_REPEAT_NGRAM, **options
            )
            for i, result in zip(looping, retried):
                hypotheses[i] = result.hypotheses[0]
        return [self._sp.decode(tokens) for tokens in hypotheses]
