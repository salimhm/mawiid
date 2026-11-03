"""Benchmark translation quality and speed on the FLEURS sentences from fetch_samples.py.

Every sentence exists in every language, so each one is spoken (as a final transcript)
in every language and translated for a room where all the other languages are present,
through the same SubtitleTranslator the service uses. Quality is chrF: character n-gram
overlap with the reference translation, 0-100, higher is better.

    python scripts/translation_benchmark.py                 # 40 sentences, GPU if present
    python scripts/translation_benchmark.py --device cpu --limit 5
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from pathlib import Path
from statistics import mean, median

import numpy as np
import sacrebleu

from mawiid_ai.stt import LANGUAGES, ResultKind, Transcript
from mawiid_ai.translation import TranslationSettings, build_translator

PARALLEL = Path(__file__).resolve().parent.parent / "data" / "translation" / "parallel.jsonl"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--parallel", type=Path, default=PARALLEL)
    parser.add_argument("--limit", type=int, default=40, help="sentences (each is translated from every language)")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--json", type=Path, help="write every translation here")
    parser.add_argument("-v", "--verbose", action="store_true", help="print every translation")
    args = parser.parse_args()

    settings = TranslationSettings(engines=["madlad"])
    if args.device:
        settings = replace(settings, madlad=replace(settings.madlad, device=args.device))
    load_start = time.perf_counter()
    translator = build_translator(settings)
    engine = translator.engines["madlad"]
    print(f"madlad on {engine.device} ({engine.compute_type}) | loaded in {time.perf_counter() - load_start:.1f}s")

    rows = [json.loads(line) for line in args.parallel.read_text(encoding="utf-8").splitlines()][: args.limit]
    languages = [lang for lang in LANGUAGES if lang in rows[0]]
    translator.translate(Transcript(ResultKind.FINAL, "Hello", "en-US", 0, 1, "warm-up"), languages)

    hypotheses: dict[tuple[str, str], list[str]] = {}
    delays, records = [], []
    for row in rows:
        for source in languages:
            final = Transcript(ResultKind.FINAL, row[source], source, 0.0, 1.0, "reference")
            started = time.perf_counter()
            subtitles = translator.translate(final, languages)
            delays.append(time.perf_counter() - started)
            for subtitle in subtitles:
                if subtitle.language != source:
                    hypotheses.setdefault((source, subtitle.language), []).append(subtitle.text)
                    records.append({"id": row["id"], "source": source, "target": subtitle.language, "text": subtitle.text})
                    if args.verbose:
                        print(f"[{source} -> {subtitle.language}] {subtitle.text}")

    def chrf(source: str, target: str) -> float:
        return sacrebleu.corpus_chrf(hypotheses[(source, target)], [[row[target] for row in rows]]).score

    print(f"\nchrF, {len(rows)} sentences (rows: spoken language, columns: listener language)\n")
    print(f"{'':<8}" + "".join(f"{lang:>8}" for lang in languages))
    for source in languages:
        cells = "".join(f"{'-':>8}" if source == t else f"{chrf(source, t):>8.1f}" for t in languages)
        print(f"{source:<8}{cells}")
    scores = [chrf(s, t) for s in languages for t in languages if s != t]
    print(f"\nmean chrF {mean(scores):.1f}")
    print(
        f"one final -> {len(languages) - 1} listener languages: median {median(delays):.2f}s, "
        f"p95 {np.percentile(delays, 95):.2f}s, max {max(delays):.2f}s"
    )

    if args.json:
        args.json.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
