# Sovereign AI Service

Python worker for LiveKit audio capture, voice activity detection, Faster-Whisper transcription, and local targeted translation. CPU and GPU deployments will expose the same internal API.


## Speech-to-text (`mawiid_ai.stt`)

One stream per speaker: push 16 kHz mono audio in, get `partial` (live, may change) and `final` (stable phrase) transcripts out.

```python
from mawiid_ai.stt import build_router

router = build_router()                  # loads every engine this machine can run
stream = router.open_stream("fr-FR")     # language from the "Speak:" dropdown
for chunk in audio_chunks:               # int16 bytes/array or float32, any chunk size
    for result in stream.push_audio(chunk):
        print(result.kind, result.text, result.start, result.end, result.engine)
stream.flush()                           # speaker left: finalize what's buffered
```

Supported languages: `en-US`, `fr-FR`, `ar-SA`, `zh-CN`, `zh-TW` (same Mandarin audio; the text is converted to the chosen script). Darija (`ar-MA`) comes later.

### How it works

- `vad.py`: Silero voice detection (bundled with faster-whisper, no PyTorch) cuts the stream into phrases at 500 ms pauses, max 15 s each.
- `whisper_engine.py`: faster-whisper transcribes each phrase (finals) and the phrase so far, once per second (partials).
- `router.py`: each language has an ordered engine list in `config.py` (`voxtral`, then `whisper`). Engines that aren't loaded are skipped. If the active engine crashes, or is too slow (above 3 s per call) while a backup exists, the stream switches engines and replays the audio since the last final, so no speech is lost. The failed engine is skipped by all streams for 60 s, then retried at the next phrase boundary.
- `postprocess.py`: whitespace clean-up and Simplified/Traditional Chinese conversion (OpenCC).

Settings live in `config.py`; the Whisper ones can be overridden with environment variables: `MAWIID_STT_WHISPER_MODEL` (default `small`), `MAWIID_STT_WHISPER_DEVICE` (`auto`/`cpu`/`cuda`), `MAWIID_STT_WHISPER_COMPUTE_TYPE`, `MAWIID_STT_WHISPER_CPU_THREADS`, `MAWIID_STT_PARTIALS` (`auto`/`1`/`0`; auto = only with a GPU, a CPU can't keep up), `MAWIID_STT_PARTIAL_INTERVAL_S`.

### Setup and scripts

```sh
cd services/ai
python3 -m venv .venv && .venv/bin/pip install -e ".[mic,bench,dev]"
sudo apt install libportaudio2                      # only for the mic demo

.venv/bin/python -m pytest                          # unit tests + real-audio tests
.venv/bin/python scripts/fetch_samples.py           # FLEURS test clips -> data/samples/
.venv/bin/python scripts/benchmark.py -v            # accuracy + speed per language
.venv/bin/python scripts/mic_demo.py --language fr-FR
```

`data/` is git-ignored (downloaded clips, results).
