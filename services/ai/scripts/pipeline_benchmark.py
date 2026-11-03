"""Benchmark the whole subtitle path: speech in, a subtitle for every listener language out.

Each clip from fetch_samples.py is streamed in 20 ms chunks at real-time pace, as if
someone were speaking, through the same speech-to-text router and SubtitleTranslator
the service uses, both loaded at once (on one GPU if there is one). The room holds
every language, so each final is translated into all the others.

Latency is measured from the end of the last word (the final's end timestamp) to the
moment every listener's subtitle is ready. It includes the pause the VAD waits for
before it calls a phrase finished, and any backlog when a model call takes longer
than the audio it covers.

    python scripts/pipeline_benchmark.py              # 3 clips per language
    python scripts/pipeline_benchmark.py --limit 1 --languages fr-FR
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from statistics import median

import numpy as np

from benchmark import CHUNK, SAMPLES_DIR, TAIL_SILENCE_S, load_audio
from mawiid_ai.stt import LANGUAGES, SAMPLE_RATE, ResultKind, SttSettings, Transcript, build_router
from mawiid_ai.translation import TranslationSettings, build_translator


def run_clip(router, translator, language: str, audio: np.ndarray, room: list[str], verbose: bool) -> list[float]:
    stream = router.open_stream(language)
    padded = np.concatenate([audio, np.zeros(int(TAIL_SILENCE_S * SAMPLE_RATE), dtype=np.float32)])
    delays = []
    started = time.perf_counter()
    for i in range(0, len(padded), CHUNK):
        # A chunk can't be pushed before it has been "spoken"; after a slow call the backlog goes in at once.
        wait = started + (i + CHUNK) / SAMPLE_RATE - time.perf_counter()
        if wait > 0:
            time.sleep(wait)
        for result in stream.push_audio(padded[i : i + CHUNK]):
            subtitles = translator.translate(result, room)
            if result.kind is ResultKind.FINAL:
                delay = time.perf_counter() - (started + result.end)
                delays.append(delay)
                if verbose:
                    print(f"  {delay:5.2f}s  [{language}] {result.text}")
                    for subtitle in subtitles:
                        if subtitle.language != language:
                            print(f"         [{subtitle.language}] {subtitle.text}")
    stream.flush()  # anything left only after the 1 s of silence isn't a live result; not counted
    return delays


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--samples", type=Path, default=SAMPLES_DIR)
    parser.add_argument("--languages", nargs="+", help="spoken languages (default: every sample language)")
    parser.add_argument("--limit", type=int, default=3, help="clips per language")
    parser.add_argument("-v", "--verbose", action="store_true", help="print every final and its subtitles")
    args = parser.parse_args()

    load_start = time.perf_counter()
    stt_settings = SttSettings()
    router = build_router(stt_settings)
    translator = build_translator(TranslationSettings())
    engine = translator.engines[translator.order[0]]
    print(
        f"stt: {', '.join(router.engines)} | translation: {', '.join(translator.order)} on {engine.device} "
        f"({engine.compute_type}) | loaded in {time.perf_counter() - load_start:.1f}s"
    )

    room = list(LANGUAGES)
    translator.translate(Transcript(ResultKind.FINAL, "Hello", "en-US", 0, 1, "warm-up"), room)
    languages = args.languages or sorted(p.name for p in args.samples.iterdir() if (p / "manifest.jsonl").exists())
    all_delays: list[float] = []
    print(f"\n{'spoken':<8} {'finals':>6} {'median':>7} {'p95':>6} {'max':>6}")
    for language in languages:
        lang_dir = args.samples / language
        entries = [json.loads(line) for line in (lang_dir / "manifest.jsonl").read_text(encoding="utf-8").splitlines()]
        delays: list[float] = []
        for entry in entries[: args.limit]:
            delays += run_clip(router, translator, language, load_audio(lang_dir / entry["audio"]), room, args.verbose)
        all_delays += delays
        if delays:
            print(f"{language:<8} {len(delays):>6} {median(delays):>6.2f}s {np.percentile(delays, 95):>5.2f}s {max(delays):>5.2f}s")

    if not all_delays:
        print("no finals produced")
        return 1
    print(
        f"\nlast word -> subtitles in all {len(room)} room languages, {len(all_delays)} finals: "
        f"median {median(all_delays):.2f}s, p95 {np.percentile(all_delays, 95):.2f}s, max {max(all_delays):.2f}s"
        f"\n(includes the {stt_settings.vad.min_silence_ms} ms pause that ends a phrase)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
