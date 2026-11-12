"""Convert MADLAD-400 (3B or 10B) to CTranslate2 for the translation engine. Run once per machine.

Needs the conversion extras; the CPU build of torch is enough:

    .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
    .venv/bin/pip install -e ".[convert]"
    .venv/bin/python scripts/convert_translation_model.py               # 3b, or MAWIID_MT_MODEL
    .venv/bin/python scripts/convert_translation_model.py --model 10b

3b: downloads ~12 GB from Hugging Face, peaks at ~9 GB of RAM (weights are loaded as float16)
and writes ~2.8 GB (int8 weights). 10b: downloads ~43 GB, peaks at ~24 GB of RAM and writes
~11 GB. Output goes to <models dir>/madlad400-<size>-mt-ct2 (MAWIID_MODELS_DIR, default
data/models), where the engine looks for MAWIID_MT_MODEL. In the Docker image:

    docker compose ... --profile ai run --rm ai sh -c \
      "pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install '.[convert]' \
       && python scripts/convert_translation_model.py --model 10b"
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from mawiid_ai.translation.config import MODELS, model_dir, model_size
from mawiid_ai.translation.madlad_engine import encode

SAMPLES = [("Bonjour à tous, vous m'entendez ?", "en-US"), ("这是简体中文", "ar-SA"), ("مرحبا بالجميع", "zh-TW")]


def check_tokenizer(hf_model: str, out: Path) -> None:
    """The engine tokenizes with plain sentencepiece; it must match the reference tokenizer."""
    import sentencepiece
    from transformers import AutoTokenizer

    reference = AutoTokenizer.from_pretrained(hf_model)
    sp = sentencepiece.SentencePieceProcessor(model_file=str(out / "spiece.model"))
    for text, target in SAMPLES:
        tag = f"<2{target[:2]}>"
        want = reference.convert_ids_to_tokens(reference.encode(f"{tag} {text}"))
        got = encode(sp, text, target)
        if got != want:
            raise SystemExit(f"tokenizer mismatch for {text!r}:\n  engine:    {got}\n  reference: {want}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", choices=sorted(MODELS), default=model_size(), help="MADLAD size (default: MAWIID_MT_MODEL or 3b)")
    parser.add_argument("--out", type=Path, help="output directory (default: where the engine looks for this size)")
    parser.add_argument("--force", action="store_true", help="overwrite an existing conversion")
    args = parser.parse_args()
    hf_model = MODELS[args.model]
    args.out = args.out or model_dir(args.model)

    from ctranslate2.converters import TransformersConverter

    if (args.out / "model.bin").exists() and not args.force:
        print(f"{args.out} already exists (use --force to redo it)")
    else:
        started = time.perf_counter()
        converter = TransformersConverter(
            hf_model, copy_files=["spiece.model"], load_as_float16=True, low_cpu_mem_usage=True
        )
        # bfloat16 scales: T5 activations overflow in float16. CPUs and older GPUs convert at load time.
        converter.convert(str(args.out), quantization="int8_bfloat16", force=True)
        print(f"converted {hf_model} -> {args.out} in {time.perf_counter() - started:.0f}s")
    check_tokenizer(hf_model, args.out)
    print("tokenizer check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
