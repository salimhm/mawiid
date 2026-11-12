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

Languages switched on: `en-US`, `fr-FR`, `ar-SA` and `ar-MA` (Darija, see below). The code also handles `zh-CN` and `zh-TW` (same Mandarin audio; the text is converted to the chosen script), but they are off for now. `MAWIID_LANGUAGES` picks the languages (default `en-US,fr-FR,ar-SA,ar-MA`); to turn Chinese back on, set `MAWIID_LANGUAGES=en-US,fr-FR,ar-SA,ar-MA,zh-CN,zh-TW` and uncomment it in the frontend's `MeetControls.jsx`. While a language is off, a listener who picks it reads the original text, and a speaker who picks `ar-MA` is transcribed as `ar-SA`. Their tests are skipped. At startup the worker logs the engines each language is transcribed with (`stt route ar-MA: whisper-darija, whisper`).

### Darija (`ar-MA`)

Darija is detected automatically. Whisper's language detection reports one `"ar"` for Standard Arabic and Darija, so the words decide instead (`stt/dialect.py`): every Arabic phrase is transcribed by the Darija model, which also writes Standard Arabic, and one Darija-only word (ديال, واش, بزاف, دابا...) labels the speaker `ar-MA`. They go back to `ar-SA` after three phrases of six words or more without any. Stock Whisper still detects English, French or Arabic for each phrase, so `ar-MA` routes to stock Whisper first, which hands its Arabic phrases to the Darija model, and to the Darija model alone as the backup. A speaker whose `mawiid.spoken_language` is set keeps that label; their Arabic phrases still go to the Darija model. Measured on 12 Standard Arabic clips (FLEURS) and 24 Darija clips (DVoice, adiren7): no Standard Arabic clip had a Darija word; Darija was found in 12 of 12 long clips (~28 s) and 7 of 12 short phrases (~4 s), and the speaker then stays on Darija. The Darija model brings Darija error (CER) from 63% to 35% on the long clips, but is a little worse than `small` on Standard Arabic (14% against 11%), and takes about 0.9 s of CPU per second of speech against 0.2 s for `small`. On a weak CPU, `MAWIID_STT_DETECT_DARIJA=0` turns detection off: then only people who read captions in Darija are transcribed with the Darija model, and other Arabic stays on stock Whisper.

Stock Whisper hears Darija as Arabic and misses most dialect words, so Arabic goes to a Darija-tuned Whisper (`whisper-darija`). The model is converted once per machine into `data/models/whisper-darija-ct2` (needs the same `convert` extras as the translation model):

```sh
.venv/bin/python scripts/convert_darija_model.py --model turbo    # anaszil/whisper-large-v3-turbo-darija (MIT)
.venv/bin/python scripts/convert_darija_model.py --model medium --out data/models/whisper-darija-medium-ct2  # ychafiqui (Apache 2.0)
MAWIID_STT_DARIJA_MODEL=data/models/whisper-darija-medium-ct2 ...  # pick another conversion
```

`make ai-models-darija` runs the `turbo` conversion if the model is missing. Without a converted model the engine is skipped, the worker logs an error and Darija goes to stock Whisper, which transcribes it as Standard Arabic. Output is Arabic script. Test clips come from DVoice v2.0 and adiren7/darija_speech_to_text (`fetch_samples.py --languages ar-MA`); the benchmark scores each source separately and also reports CER, because Darija has no standard spelling and WER counts every spelling variant as an error.

### How it works

- `vad.py`: Silero voice detection (bundled with faster-whisper, no PyTorch) cuts the stream into phrases at 500 ms pauses, max 6 s each, so non-stop speech still shows up.
- `whisper_engine.py`: faster-whisper transcribes each phrase (finals) and the phrase so far, up to once per second (partials), using at most half the time so a slow machine shows fewer partials instead of falling behind. On a CPU it encodes the phrase plus 3 s of silence (at least 10 s) instead of Whisper's fixed 30 s, which is 3-4 times faster.
- `router.py`: each language has an ordered engine list in `config.py` (`voxtral`, then `whisper`). Engines that aren't loaded are skipped. If the active engine crashes, or is too slow (above 3 s per call) while a backup exists, the stream switches engines and replays the audio since the last final, so no speech is lost. The failed engine is skipped by all streams for 60 s, then retried at the next phrase boundary.
- `postprocess.py`: whitespace clean-up and Simplified/Traditional Chinese conversion (OpenCC).

Settings live in `config.py`; the Whisper ones can be overridden with environment variables: `MAWIID_STT_WHISPER_MODEL` (default `small`), `MAWIID_STT_WHISPER_DEVICE` (`auto`/`cpu`/`cuda`), `MAWIID_STT_WHISPER_COMPUTE_TYPE`, `MAWIID_STT_WHISPER_CPU_THREADS`, `MAWIID_STT_PARTIALS` (`auto`/`1`/`0`; auto = only with a GPU, a CPU can't keep up), `MAWIID_STT_PARTIAL_INTERVAL_S`, `MAWIID_STT_DETECT_LANGUAGE` (`1`/`0`, see below).

**Language detection** (`MAWIID_STT_DETECT_LANGUAGE=1`, the default): Whisper detects the language of each phrase among the enabled ones (`MAWIID_LANGUAGES`). This applies to speakers on **I speak: Auto** in the app (the default, `mawiid.spoken_language` empty or `auto`), starting from the language they read captions in. A speaker who picks a language is always transcribed in it. A phrase switches language only when Whisper is at least 70% sure among the enabled languages, and phrases under 1 s keep the current language, so a stray "OK" doesn't flip it. Partials detect once per phrase (at their first second of audio) and the final checks again on the whole phrase. It costs one extra Whisper encoder pass per phrase (~0.4 s for `small` on a laptop CPU, much less on a GPU). `MAWIID_STT_DETECT_LANGUAGE=0` turns detection off for everyone: Auto then means the language they read.

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

- Darija listeners read Modern Standard Arabic, and Darija and Arabic listeners read each other's original text: MADLAD's `<2ary>` tag returns lossy Standard Arabic, and its Darija-to-Arabic output changed the meaning in testing. Its Darija-to-English and French output is also unreliable.
- Each language is translated once, however many listeners picked it. `zh-CN` and `zh-TW` share one translation, converted to each script. Listeners who speak the speaker's language get the transcript as-is.
- Live translation (`MAWIID_MT_PARTIALS`, off by default; `1` turns it on): while someone talks, the words two partials in a row agree on are translated once at least 2 more are stable, so the subtitle grows with the speech without flickering. If a newer one arrives while a translation is waiting, the older one is dropped, so a slow machine sends fewer updates instead of falling behind. It needs speech-to-text partials (`MAWIID_STT_PARTIALS=1`). Off, only finished phrases are translated (less GPU load, and no draft translation shown before the final one).
- Model: [MADLAD-400 3B](https://huggingface.co/google/madlad400-3b-mt) (Apache 2.0), int8 in CTranslate2, greedy decoding. Finals are split into sentences, because MADLAD drops sentences from long inputs. Output length is capped, and looping outputs are retried. `&apos;` and similar escapes are cleaned up.
- If the engine fails, it is skipped for 60 s, like the speech-to-text router. `MAWIID_MT_CPU_BACKUP=1` loads a second copy on the CPU as backup (~3 GB of RAM). It is a last resort: on a Core Ultra 7 155H it needs 2.6 s median and 4.6 s p95 per final, against 0.7 s on the GPU.

Settings: `MAWIID_MT_MODEL` (`3b`, the default, or `10b`: better translations, Darija included, but ~11 GB of GPU memory and ~3x slower, so for GPU hosts; convert it with `scripts/convert_translation_model.py --model 10b`), `MAWIID_MT_MODEL_PATH` (default `<MAWIID_MODELS_DIR>/madlad400-<size>-mt-ct2`; `MAWIID_MODELS_DIR` defaults to `data/models`, `/models` in Docker), `MAWIID_MT_DEVICE` (`auto`/`cpu`/`cuda`; auto falls back to the CPU if the GPU can't load), `MAWIID_MT_COMPUTE_TYPE`, `MAWIID_MT_CPU_THREADS`, `MAWIID_MT_PARTIALS`, `MAWIID_MT_CPU_BACKUP`.

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


## Live worker (`mawiid_ai.agent`)

Links the two modules above to the app's calls. It is a LiveKit agent (`livekit-agents`) named `mawiid-translator`: LiveKit sends it only the rooms the backend dispatches it to, which happens when a participant turns on their own captions (`PATCH /participant` with `participant_translation_enabled: true`). It stays until the room closes, and transcribes, sends and saves nothing while nobody has captions on.

In each room it:

1. Subscribes to every person's microphone (16 kHz mono) and runs one speech-to-text stream per speaker, in the language of the speaker's `mawiid.spoken_language` attribute, or `mawiid.language` until one is set (`en`, `fr`, `ar`, `ar-MA`, `zh-CN`, `zh-TW`; other codes fall back to the language without region, then to `en-US`).
2. Sends each partial and final result on the `lk.transcription` text-stream topic to the participants with captions on who read the spoken language (or a language no model handles).
3. Translates for everyone else, once per language that listeners picked (the same `mawiid.language` attribute), and sends it on `mawiid.translation.v1`, only to the listeners of that language: live while the speaker talks (see above), then the finished text. A final that ends mid-sentence (no `.`, `?`, `!`, `؟`) stays open: the next phrase is translated together with it under the same segment id, so listeners see one subtitle that grows and MADLAD gets whole sentences. It is closed after 1.5 s of silence or at 300 characters. If translation fails, those listeners get the original.
4. Saves final segments with their translations in the vault through the backend (`POST /transcript/internal`, every 5 s). When finals were translated together, the translation is saved on the last of them.

Whisper also gets the end of the speaker's previous phrase as a prompt (`MAWIID_STT_CONTEXT_CHARS`, default 200, `0` turns it off), so a phrase cut mid-sentence continues the sentence instead of getting a false full stop, and names keep their spelling.

Arabic (`ar-SA`, `ar-MA`) gets no prompt, whatever `MAWIID_STT_CONTEXT_CHARS` says: on unsure dialect audio Whisper continues the prompt in Standard Arabic instead of transcribing, and each made-up phrase becomes the next prompt. Arabic segments whose average log probability stays below -1.0 after the temperature retries are also dropped (`Language.min_segment_logprob`). For every language, a final is dropped when it is longer than 15 characters plus 20 per second of audio (made up), or when it repeats the previous final word for word and is at least 20 characters long (Whisper looping over silence).

Stock Whisper is trained mostly on Standard Arabic and `small` is weak in Arabic; use `MAWIID_STT_WHISPER_MODEL=medium` or `large-v3` for `ar-SA` when the machine can run it.

Without the converted MADLAD model, step 3 is skipped and everyone gets captions in the spoken language. The topics and attributes are described in `apps/backend/src/module/main/participants/integration.md` (section 8). The code: `pipeline.py` (one room, no LiveKit code, tested with fakes in `tests/test_pipeline.py`), `uploader.py` (transcript batches), `worker.py` (LiveKit wiring). Rooms run as threads in one process, so every room shares the models loaded once.

### Running it

From the repository root, with the backend's LiveKit settings in `.env`:

```sh
make ai-install    # .venv with Python 3.11+ (make ai-install PYTHON=python3.12)
make infra seed    # local LiveKit and Redis, test users
make backend       # in another terminal
make ai            # in another terminal: python -m mawiid_ai.agent dev
```

Or directly: `.venv/bin/python -m mawiid_ai.agent dev` (`start` in production) with these variables:

| Variable                                             | Purpose                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The LiveKit server, same project as the backend                 |
| `LIVEKIT_TRANSLATOR_AGENT`                           | Agent name, default `mawiid-translator`; must match the backend |
| `MAWIID_BACKEND_URL`, `INTERNAL_SERVICE_TOKEN`       | Where to save transcripts; without them nothing is saved        |
| `MAWIID_STT_*`, `MAWIID_MT_*`                        | Model settings (sections above)                                 |

The first start downloads Whisper. On a machine without CUDA libraries, set `MAWIID_STT_WHISPER_DEVICE=cpu` (`MAWIID_STT_PARTIALS=0` turns partials off if the machine is short of CPU).
