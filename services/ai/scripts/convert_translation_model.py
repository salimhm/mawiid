"""Convert MADLAD-400 3B to CTranslate2 for the translation engine. Run once per machine.

Needs the conversion extras; the CPU build of torch is enough:

    .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
    .venv/bin/pip install -e ".[convert]"
    .venv/bin/python scripts/convert_translation_model.py

Downloads ~12 GB from Hugging Face, peaks at ~9 GB of RAM (weights are loaded as float16)
and writes ~2.8 GB to data/models/madlad400-3b-mt-ct2 (int8 weights).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from mawiid_ai.translation.config import DEFAULT_MODEL_PATH
from mawiid_ai.translation.madlad_engine import encode

HF_MODEL = "google/madlad400-3b-mt"
SAMPLES = [("Bonjour à tous, vous m'entendez ?", "en-US"), ("这是简体中文", "ar-SA"), ("مرحبا بالجميع", "zh-TW")]


def check_tokenizer(out: Path) -> None:
    """The engine tokenizes with plain sentencepiece; it must match the reference tokenizer."""
    import sentencepiece
    from transformers import AutoTokenizer

    reference = AutoTokenizer.from_pretrained(HF_MODEL)
    sp = sentencepiece.SentencePieceProcessor(model_file=str(out / "spiece.model"))
    for text, target in SAMPLES:
        tag = f"<2{target[:2]}>"
        want = reference.convert_ids_to_tokens(reference.encode(f"{tag} {text}"))
        got = encode(sp, text, target)
        if got != want:
            raise SystemExit(f"tokenizer mismatch for {text!r}:\n  engine:    {got}\n  reference: {want}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--force", action="store_true", help="overwrite an existing conversion")
    args = parser.parse_args()

    from ctranslate2.converters import TransformersConverter

    if (args.out / "model.bin").exists() and not args.force:
        print(f"{args.out} already exists (use --force to redo it)")
    else:
        started = time.perf_counter()
        converter = TransformersConverter(
            HF_MODEL, copy_files=["spiece.model"], load_as_float16=True, low_cpu_mem_usage=True
        )
        # bfloat16 scales: T5 activations overflow in float16. CPUs and older GPUs convert at load time.
        converter.convert(str(args.out), quantization="int8_bfloat16", force=True)
        print(f"converted {HF_MODEL} -> {args.out} in {time.perf_counter() - started:.0f}s")
    check_tokenizer(args.out)
    print("tokenizer check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
