"""Benchmark speech-to-text accuracy and speed on the clips from fetch_samples.py.

Audio is pushed in 20 ms chunks, exactly like a live call, through the same
router the service uses. Accuracy is word error rate (WER), or character error
rate (CER) for Chinese, after removing punctuation and case.

    python scripts/benchmark.py                      # all languages, whisper small
    python scripts/benchmark.py --model large-v3-turbo --languages fr-FR ar-SA
    python scripts/benchmark.py --partials --limit 3 # include live partial results
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from dataclasses import replace
from pathlib import Path
from statistics import mean

import jiwer
import numpy as np
import soundfile as sf

from mawiid_ai.stt import SAMPLE_RATE, ResultKind, SttSettings, build_router

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "data" / "samples"
CHUNK = SAMPLE_RATE // 50  # 20 ms, LiveKit's frame size
TAIL_SILENCE_S = 1.0  # lets the VAD notice the speaker stopped

_ARABIC_DIACRITICS = re.compile("[ً-ْٰـ]")
_ARABIC_LETTERS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه"})


def normalize(text: str, language: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    if language.startswith("ar"):
        text = _ARABIC_DIACRITICS.sub("", text).translate(_ARABIC_LETTERS)
    # Punctuation and symbols become spaces (keeps "l'homme" -> "l homme" on both sides).
    text = "".join(" " if unicodedata.category(ch)[0] in "PS" else ch for ch in text)
    if language.startswith("zh"):
        return "".join(text.split())
    return " ".join(text.split())


def error_rate(reference: str, hypothesis: str, language: str) -> float:
    ref, hyp = normalize(reference, language), normalize(hypothesis, language)
    if language.startswith("zh"):
        return jiwer.cer(ref, hyp)
    return jiwer.wer(ref, hyp)


def char_error_rate(reference: str, hypothesis: str, language: str) -> float:
    """CER ignoring spaces. Fairer for Darija, which has no standard spelling or word splitting."""
    ref, hyp = normalize(reference, language), normalize(hypothesis, language)
    return jiwer.cer(ref.replace(" ", ""), hyp.replace(" ", ""))


def load_audio(path: Path) -> np.ndarray:
    audio, rate = sf.read(path, dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != SAMPLE_RATE:
        raise ValueError(f"{path} is {rate} Hz, expected {SAMPLE_RATE}")
    return audio


def run_clip(router, language: str, audio: np.ndarray) -> dict:
    stream = router.open_stream(language)
    padded = np.concatenate([audio, np.zeros(int(TAIL_SILENCE_S * SAMPLE_RATE), dtype=np.float32)])
    finals: list[str] = []
    final_delays: list[float] = []
    partial_delays: list[float] = []
    partials = 0
    engines: set[str] = set()

    started = time.perf_counter()
    for i in range(0, len(padded), CHUNK):
        call_start = time.perf_counter()
        results = stream.push_audio(padded[i : i + CHUNK])
        took = time.perf_counter() - call_start
        for r in results:
            engines.add(r.engine)
            if r.kind is ResultKind.FINAL:
                finals.append(r.text)
                final_delays.append(took)
            else:
                partials += 1
                partial_delays.append(took)
    for r in stream.flush():
        finals.append(r.text)
        engines.add(r.engine)
    elapsed = time.perf_counter() - started

    return {
        "hypothesis": " ".join(finals),
        "rtf": elapsed / (len(audio) / SAMPLE_RATE),
        "final_delays": final_delays,
        "partial_delays": partial_delays,
        "partials": partials,
        "engines": sorted(engines),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--samples", type=Path, default=SAMPLES_DIR)
    parser.add_argument("--languages", nargs="+")
    parser.add_argument("--model", help="whisper model size, e.g. small, medium, large-v3-turbo")
    parser.add_argument("--beam", type=int, help="beam size for final results (default 5; 1 is faster)")
    parser.add_argument("--partials", action="store_true", help="also produce live partial results (slower)")
    parser.add_argument("--darija-model", help="converted Darija model folder (default: data/models/whisper-darija-ct2)")
    parser.add_argument("--engines", nargs="+", help="force this engine order for every language, e.g. --engines whisper")
    parser.add_argument("--limit", type=int, help="clips per language")
    parser.add_argument("--json", type=Path, help="write per-clip results here")
    parser.add_argument("-v", "--verbose", action="store_true", help="print every reference/hypothesis pair")
    args = parser.parse_args()

    settings = SttSettings()
    whisper = replace(settings.whisper, partials="1" if args.partials else "0")
    if args.model:
        whisper = replace(whisper, model=args.model)
    if args.beam:
        whisper = replace(whisper, beam_size=args.beam)
    settings = replace(settings, whisper=whisper)
    if args.darija_model:
        settings = replace(settings, darija=replace(settings.darija, model=args.darija_model))
    if args.engines:
        settings = replace(settings, routes={lang: list(args.engines) for lang in settings.routes})

    load_start = time.perf_counter()
    router = build_router(settings)
    print(f"engines: {', '.join(router.engines)} | whisper {whisper.model} beam {whisper.beam_size} | loaded in {time.perf_counter() - load_start:.1f}s")

    languages = args.languages or sorted(p.name for p in args.samples.iterdir() if (p / "manifest.jsonl").exists())
    rows, records = [], []
    for language in languages:
        lang_dir = args.samples / language
        entries = [json.loads(line) for line in (lang_dir / "manifest.jsonl").read_text(encoding="utf-8").splitlines()]
        # Darija clips come from several datasets; score each separately.
        by_source: dict[str, list[dict]] = {}
        for entry in entries:
            by_source.setdefault(entry.get("source", ""), []).append(entry)
        for source, group in by_source.items():
            label = f"{language}/{source}" if source else language
            group = group[: args.limit] if args.limit else group
            errors, cers, rtfs, final_delays, partial_delays, durations = [], [], [], [], [], []
            for entry in group:
                audio = load_audio(lang_dir / entry["audio"])
                result = run_clip(router, language, audio)
                err = error_rate(entry["text"], result["hypothesis"], language)
                errors.append(err)
                cers.append(char_error_rate(entry["text"], result["hypothesis"], language))
                rtfs.append(result["rtf"])
                final_delays += result["final_delays"]
                partial_delays += result["partial_delays"]
                durations.append(len(audio) / SAMPLE_RATE)
                records.append(
                    {"language": language, "source": source, "audio": entry["audio"], "reference": entry["text"], "error": err, **result}
                )
                if args.verbose:
                    print(f"\n[{label}] {entry['audio']}  error={err:.0%}  rtf={result['rtf']:.2f}  engines={result['engines']}")
                    print(f"  ref: {entry['text']}")
                    print(f"  hyp: {result['hypothesis']}")
            rows.append(
                (
                    label,
                    "CER" if language.startswith("zh") else "WER",
                    mean(errors),
                    mean(cers),
                    len(group),
                    sum(durations),
                    mean(rtfs),
                    mean(final_delays) if final_delays else float("nan"),
                    mean(partial_delays) if partial_delays else float("nan"),
                )
            )

    print(f"\n{'language':<14} {'metric':<6} {'error':>6} {'CER':>6} {'clips':>5} {'audio':>7} {'speed':>6} {'final':>7} {'partial':>8}")
    for label, metric, err, cer, clips, audio_s, rtf, final, partial in rows:
        partial_s = f"{partial:.2f}s" if partial == partial else "-"
        print(f"{label:<14} {metric:<6} {err:>6.1%} {cer:>6.1%} {clips:>5} {audio_s:>6.0f}s {rtf:>6.2f} {final:>6.2f}s {partial_s:>8}")
    print(
        "\nCER  = character error rate, spaces ignored (Darija has no standard spelling, so WER overstates errors)"
        "\nspeed = processing time / audio length (below 1.0 keeps up with live speech)"
        "\nfinal = compute time to produce a final result after the pause is detected"
        f" (the pause itself adds {settings.vad.min_silence_ms} ms)"
    )

    if args.json:
        args.json.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
