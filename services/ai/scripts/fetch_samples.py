"""Download a few test clips per language from Google FLEURS (CC-BY 4.0).

Each clip is real read speech with a reference transcript. Clips land in
``data/samples/<language>/`` next to a ``manifest.jsonl`` the benchmark reads.
FLEURS reads the same sentences in every language, so the sentences shared by all
languages also go to ``data/translation/parallel.jsonl`` for translation_benchmark.py.

    python scripts/fetch_samples.py --per-language 10
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

import opencc

BASE_URL = "https://huggingface.co/datasets/google/fleurs/resolve/main/data"

# Mawiid language code -> FLEURS config. FLEURS has no Traditional Chinese set,
# so zh-TW reuses the Mandarin audio with a Traditional-script reference.
FLEURS_CONFIGS = {
    "en-US": "en_us",
    "fr-FR": "fr_fr",
    "ar-SA": "ar_eg",
    "zh-CN": "cmn_hans_cn",
    "zh-TW": "cmn_hans_cn",
}

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "data" / "samples"
DEFAULT_PARALLEL = Path(__file__).resolve().parent.parent / "data" / "translation" / "parallel.jsonl"


def read_transcripts(config: str) -> dict[str, tuple[str, str]]:
    """Map wav file name -> (sentence id, raw transcription)."""
    with urllib.request.urlopen(f"{BASE_URL}/{config}/test.tsv", timeout=60) as response:
        text = response.read().decode("utf-8")
    rows = csv.reader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE)
    return {row[1]: (row[0], row[2]) for row in rows if len(row) > 2}


def fetch_language(language: str, transcripts: dict[str, tuple[str, str]], per_language: int, out_dir: Path) -> None:
    config = FLEURS_CONFIGS[language]
    to_traditional = opencc.OpenCC("s2tw") if language == "zh-TW" else None

    lang_dir = out_dir / language
    lang_dir.mkdir(parents=True, exist_ok=True)
    seen_sentences: set[str] = set()
    entries = []

    # The archive is gzip-streamed, so we stop reading once we have enough clips.
    url = f"{BASE_URL}/{config}/audio/test.tar.gz"
    with urllib.request.urlopen(url, timeout=60) as response:
        with tarfile.open(fileobj=response, mode="r|gz") as archive:
            for member in archive:
                name = Path(member.name).name
                if not member.isfile() or name not in transcripts:
                    continue
                sentence_id, text = transcripts[name]
                if sentence_id in seen_sentences:
                    continue
                seen_sentences.add(sentence_id)

                data = archive.extractfile(member)
                if data is None:
                    continue
                (lang_dir / name).write_bytes(data.read())
                if to_traditional is not None:
                    text = to_traditional.convert(text)
                entries.append({"audio": name, "text": text, "language": language})
                if len(entries) >= per_language:
                    break

    with open(lang_dir / "manifest.jsonl", "w", encoding="utf-8") as manifest:
        for entry in entries:
            manifest.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"{language}: {len(entries)} clips -> {lang_dir}")


def write_parallel(transcripts: dict[str, dict[str, tuple[str, str]]], path: Path) -> None:
    """One line per sentence that every language has: {"id": ..., "en-US": ..., "fr-FR": ...}."""
    by_id = {
        language: {sentence_id: text for sentence_id, text in rows.values()} for language, rows in transcripts.items()
    }
    shared = sorted(set.intersection(*(set(sentences) for sentences in by_id.values())), key=int)
    to_traditional = opencc.OpenCC("s2tw")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as out:
        for sentence_id in shared:
            row = {"id": sentence_id}
            for language, sentences in by_id.items():
                text = sentences[sentence_id]
                row[language] = to_traditional.convert(text) if language == "zh-TW" else text
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"translation: {len(shared)} sentences shared by {len(by_id)} languages -> {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-language", type=int, default=10)
    parser.add_argument("--languages", nargs="+", default=list(FLEURS_CONFIGS), choices=list(FLEURS_CONFIGS))
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--parallel", type=Path, default=DEFAULT_PARALLEL)
    args = parser.parse_args()

    by_config = {config: read_transcripts(config) for config in {FLEURS_CONFIGS[lang] for lang in args.languages}}
    transcripts = {language: by_config[FLEURS_CONFIGS[language]] for language in args.languages}
    for language in args.languages:
        fetch_language(language, transcripts[language], args.per_language, args.out)
    if len(args.languages) > 1:
        write_parallel(transcripts, args.parallel)
    return 0


if __name__ == "__main__":
    sys.exit(main())
