"""Convert a Darija-tuned Whisper model to CTranslate2 for the whisper-darija engine. Run once per machine.

Needs the conversion extras; the CPU build of torch is enough:

    .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
    .venv/bin/pip install -e ".[convert]"
    .venv/bin/python scripts/convert_darija_model.py --model turbo

Models (both licensed for commercial use):
  turbo   anaszil/whisper-large-v3-turbo-darija (MIT): LoRA adapter, merged into
          openai/whisper-large-v3-turbo. Reports WER 24.9% / CER 8.3% on its own held-out set.
  medium  ychafiqui/whisper-medium-darija (Apache 2.0): full fine-tune of whisper-medium.

Writes ~0.8 GB (int8 weights) to data/models/whisper-darija-ct2, which the engine loads by
default; use --out plus MAWIID_STT_DARIJA_MODEL to keep several conversions side by side.
"""

from __future__ import annotations

import argparse
import gc
import sys
import tempfile
import time
from pathlib import Path

from mawiid_ai.stt.config import DEFAULT_DARIJA_MODEL_PATH

# name -> (model or LoRA adapter on the Hub, base model the adapter applies to)
MODELS = {
    "turbo": ("anaszil/whisper-large-v3-turbo-darija", "openai/whisper-large-v3-turbo"),
    "medium": ("ychafiqui/whisper-medium-darija", None),
}


def export(source: str, base: str | None, staging: Path) -> None:
    """Save a plain transformers checkpoint (adapter merged) with its tokenizer and feature extractor."""
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    model = WhisperForConditionalGeneration.from_pretrained(base or source, torch_dtype=torch.float16)
    if base is not None:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, source).merge_and_unload()
    model.save_pretrained(staging)
    # faster-whisper reads tokenizer.json and preprocessor_config.json from the model folder. Without them
    # it falls back to whisper-tiny's, which is wrong for large-v3 models (different vocabulary, 128 mel bins).
    WhisperProcessor.from_pretrained(base or source).save_pretrained(staging)
    del model
    gc.collect()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", choices=list(MODELS), default="turbo")
    parser.add_argument("--out", type=Path, default=DEFAULT_DARIJA_MODEL_PATH)
    parser.add_argument("--force", action="store_true", help="overwrite an existing conversion")
    args = parser.parse_args()

    if (args.out / "model.bin").exists() and not args.force:
        print(f"{args.out} already exists (use --force to redo it)")
        return 0

    from ctranslate2.converters import TransformersConverter

    source, base = MODELS[args.model]
    started = time.perf_counter()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.out.parent, prefix=".staging-") as staging:
        export(source, base, Path(staging))
        converter = TransformersConverter(
            staging,
            copy_files=["tokenizer.json", "preprocessor_config.json"],
            load_as_float16=True,
            low_cpu_mem_usage=True,
        )
        # int8 weights; faster-whisper picks int8 on CPU and int8_float16 on GPU at load time.
        converter.convert(str(args.out), quantization="int8_float16", force=True)
    print(f"converted {source} -> {args.out} in {time.perf_counter() - started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
