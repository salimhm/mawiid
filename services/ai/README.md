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

Supported languages: `en-US`, `fr-FR`, `ar-SA`, `zh-CN`, `zh-TW` (same Mandarin audio; the text is converted to the chosen script) and `ar-MA` (Darija, see below).

### Darija (`ar-MA`)

Stock Whisper hears Darija as Arabic and misses most dialect words, so `ar-MA` routes to a Darija-tuned Whisper first (`whisper-darija`), with stock Whisper as the backup. The model is converted once per machine into `data/models/whisper-darija-ct2` (needs the same `convert` extras as the translation model):

```sh
.venv/bin/python scripts/convert_darija_model.py --model turbo    # anaszil/whisper-large-v3-turbo-darija (MIT)
.venv/bin/python scripts/convert_darija_model.py --model medium --out data/models/whisper-darija-medium-ct2  # ychafiqui (Apache 2.0)
MAWIID_STT_DARIJA_MODEL=data/models/whisper-darija-medium-ct2 ...  # pick another conversion
```

Without a converted model the engine is skipped and Darija goes to stock Whisper. Output is Arabic script. Test clips come from DVoice v2.0 and adiren7/darija_speech_to_text (`fetch_samples.py --languages ar-MA`); the benchmark scores each source separately and also reports CER, because Darija has no standard spelling and WER counts every spelling variant as an error.

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


## Translation (`mawiid_ai.translation`)

Each speech-to-text result goes in with the languages listeners picked, and one subtitle per language comes out.

```python
from mawiid_ai.translation import build_translator

translator = build_translator()          # loads MADLAD-400, GPU if it can
for result in stream.push_audio(chunk):  # one speaker's transcripts
    for subtitle in translator.translate(result, ["en-US", "ar-SA", "zh-TW"]):
        send(subtitle.language, subtitle.text)
```

- Each language is translated once, however many listeners picked it. `zh-CN` and `zh-TW` share one translation, converted to each script. Listeners who speak the speaker's language get the transcript as-is.
- Only finals are translated. Partials go only to listeners of the speaker's language (`MAWIID_MT_PARTIALS=1` translates them too, at several times the GPU load).
- Model: [MADLAD-400 3B](https://huggingface.co/google/madlad400-3b-mt) (Apache 2.0), int8 in CTranslate2, greedy decoding. Finals are split into sentences, because MADLAD drops sentences from long inputs. Output length is capped, and looping outputs are retried. `&apos;` and similar escapes are cleaned up.
- If the engine fails, it is skipped for 60 s, like the speech-to-text router. `MAWIID_MT_CPU_BACKUP=1` loads a second copy on the CPU as backup (~3 GB of RAM). It is a last resort: on a Core Ultra 7 155H it needs 2.6 s median and 4.6 s p95 per final, against 0.7 s on the GPU.

Settings: `MAWIID_MT_MODEL_PATH`, `MAWIID_MT_DEVICE` (`auto`/`cpu`/`cuda`; auto falls back to the CPU if the GPU can't load), `MAWIID_MT_COMPUTE_TYPE`, `MAWIID_MT_CPU_THREADS`, `MAWIID_MT_PARTIALS`, `MAWIID_MT_CPU_BACKUP`.

### Setup

The model is converted once per machine into `data/models/madlad400-3b-mt-ct2` (~2.8 GB). This needs ~12 GB of downloads and ~9 GB of RAM; see `scripts/convert_translation_model.py`:

```sh
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -e ".[convert]"
.venv/bin/python scripts/convert_translation_model.py
```

On a GPU, CTranslate2 (Whisper and MADLAD) needs CUDA 12 cuBLAS and cuDNN 9. Without a CUDA toolkit installed, use the pip wheels: `pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"`. Then put their library folders on the search path: `site-packages/nvidia/{cublas,cudnn}/lib` on `LD_LIBRARY_PATH` (Linux), or `site-packages\nvidia\{cublas,cudnn,cuda_nvrtc}\bin` on `PATH` (Windows).

```sh
.venv/bin/python scripts/translation_benchmark.py      # chrF quality matrix + latency
.venv/bin/python scripts/pipeline_benchmark.py         # last word -> every subtitle, real-time
.venv/bin/python scripts/mic_demo.py --language fr-FR --translate en-US ar-SA zh-TW
```

Measured on an RTX 4060 laptop GPU with Whisper `small` and MADLAD on the same GPU, a room with all 5 languages, and FLEURS clips streamed at real-time pace. From the end of the last word to every subtitle being ready: median 1.24 s, p95 2.38 s, max 2.81 s (30 finals). This includes the 500 ms pause that ends a phrase. The tail comes from long Chinese and Arabic finals. Translation quality: mean chrF 54.3 over 20 language pairs.
