"""Live microphone transcription in the terminal.

Needs PortAudio: sudo apt install libportaudio2

    python scripts/mic_demo.py --language fr-FR
    python scripts/mic_demo.py --language zh-TW --model medium
    python scripts/mic_demo.py --language fr-FR --translate en-US ar-SA zh-TW

Partial results overwrite the current line; final results stay, followed by their
subtitles when --translate is given. Ctrl+C to stop.
"""

from __future__ import annotations

import argparse
import logging
import queue
import sys
import time
from dataclasses import replace

from mawiid_ai.stt import LANGUAGES, SAMPLE_RATE, ResultKind, SttSettings, build_router
from mawiid_ai.translation import build_translator

CHUNK = SAMPLE_RATE // 50  # 20 ms


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--language", default="en-US", choices=list(LANGUAGES))
    parser.add_argument("--model", help="whisper model size (default: small)")
    parser.add_argument(
        "--partials", choices=["auto", "1", "0"], default="auto", help="live partial results (auto: GPU only)"
    )
    parser.add_argument("--device", type=int, help="input device index (see: python -m sounddevice)")
    parser.add_argument("--translate", nargs="+", default=[], choices=list(LANGUAGES), help="listener languages")
    args = parser.parse_args()

    import sounddevice as sd

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = SttSettings()
    whisper = replace(settings.whisper, partials=args.partials)
    if args.model:
        whisper = replace(whisper, model=args.model)
    router = build_router(replace(settings, whisper=whisper))
    stream = router.open_stream(args.language)
    translator = build_translator() if args.translate else None

    chunks: queue.Queue[bytes] = queue.Queue()

    def on_audio(indata, frames, time_info, status) -> None:
        if status:
            print(status, file=sys.stderr)
        chunks.put(bytes(indata))

    print(f"listening ({args.language}, engine: {stream.engine}) - speak, Ctrl+C to stop\n")
    try:
        with sd.RawInputStream(
            samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=CHUNK, device=args.device, callback=on_audio
        ):
            while True:
                for result in stream.push_audio(chunks.get()):
                    show(result, translator, args.translate)
    except KeyboardInterrupt:
        for result in stream.flush():
            show(result, translator, args.translate)
    return 0


def show(result, translator, languages: list[str]) -> None:
    if result.kind is ResultKind.PARTIAL:
        print(f"\r\033[K… {result.text}", end="", flush=True)
        return
    print(f"\r\033[K[{result.start:6.1f}s] {result.text}", flush=True)
    if translator is not None:
        started = time.perf_counter()
        subtitles = [s for s in translator.translate(result, languages) if s.language != result.language]
        took = time.perf_counter() - started
        for subtitle in subtitles:
            print(f"          {subtitle.language}: {subtitle.text}")
        print(f"          (translated in {took:.2f}s)", flush=True)


if __name__ == "__main__":
    sys.exit(main())
