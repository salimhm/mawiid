# AI captions: why Darija and Arabic hallucinate, and how to fix it

_Last updated: 2026-11-10 · Work order for a coding agent · Scope: `services/ai`, `frontend`, `Makefile`_

This document is an implementation brief, not a discussion. It records a real defect in the live caption pipeline, explains the architectural cause with evidence from the code, and specifies the changes to make, the tests to add, and the criteria for "done". Read the whole document before editing anything.

## 1. The defect

A guest speaking **Moroccan Darija** (`ar-MA`) or **Arabic** (`ar-SA`) sees captions that are fluent but wrong: invented sentences, Standard Arabic worded differently from what was said, and phrase completions that nobody spoke. The same audio in English or French transcribes correctly.

Symptoms, as reported:

- Darija speech produces plausible Modern Standard Arabic (MSA) instead of the words actually said.
- Arabic captions sometimes continue a sentence the speaker never started.
- Long invented phrases appear after a pause or on a quiet, short phrase.
- Nothing is translated: every listener reads the original text, in Arabic script.

The last symptom is important and is **not** a hallucination. It is a second, independent failure (no translation model on the machine). Both are covered here.

## 2. The real problem in the architecture

Three design decisions combine into the reported behaviour. None is a typo; each is a structural choice that is wrong for dialectal Arabic.

| #   | Architectural fault                                                                                                          | Consequence                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| F1  | `MAWIID_LANGUAGES` gates **both** the languages offered to users **and** whether a dedicated model is loaded, and it defaults to `en-US,fr-FR,ar-SA`. | Darija is not a first-class language: it is silently collapsed to `ar-SA` and decoded by a model that was never trained for it. |
| F2  | Language **detection** is the only mechanism that can route a speaker to a different engine, but Whisper exposes a single `"ar"` code for MSA and Darija. | Auto-detect can never select Darija. The Darija engine is unreachable unless the speaker declares it up front, and the UI has no way to declare it. |
| F3  | Hallucination defence is a static list of stock credit lines plus an exact prompt-echo check, applied uniformly to every language, while the prompt and segment settings that cause invention are shared globally. | Arabic/dialect invention passes the filters. The prompt that seeds the invention is on by default and cannot be tuned per language. |

A fourth, operational fault amplifies all of them:

| #   | Fault                                                                                                            | Consequence                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| F4  | The startup path degrades silently: a missing Darija model or a missing translation model produces one log line and a fully working-looking room. | Nobody notices that captions are running on the wrong model until users complain. |

## 3. Why the agent hallucinates — cause chain

Each link below is verifiable in the current code. Together they explain every reported symptom.

### C1. Darija is decoded as MSA by stock Whisper

`services/ai/src/mawiid_ai/stt/config.py`:

```python
_DEFAULT_ENABLED = "en-US,fr-FR,ar-SA"
```

`services/ai/src/mawiid_ai/stt/factory.py`:

```python
if "ar-MA" in LANGUAGES:  # Darija is switched off by default: don't load its model then
    _load_darija(settings, engines)
```

`services/ai/src/mawiid_ai/agent/pipeline.py` collapses the code before the stream is opened, and the repository asserts this in `services/ai/tests/test_pipeline.py`:

```python
assert mawiid_language("ar-MA") == "ar-SA"  # Darija off: plain Arabic
```

Whisper has no Darija token and its Arabic training data is overwhelmingly MSA. Dialect audio is therefore mapped onto the nearest MSA token sequences, **confidently**. That is the fluent-but-wrong text users see. It is not noise; it is MSA-shaped invention.

### C2. The Darija model has never been converted on this machine

`services/ai/data/` is not present on the development machine, so neither `data/models/whisper-darija-ct2` nor `data/models/madlad400-3b-mt-ct2` is present. `scripts/convert_darija_model.py` writes the first; `scripts/convert_translation_model.py` writes the second. Unless `MAWIID_STT_DARIJA_MODEL` or `MAWIID_MT_MODEL_PATH` point elsewhere, both stages are absent.

The factory message is misleading as well — it tells the operator to run `make ai-models`, but that target (`Makefile`, `ai-models`) converts **only** the translation model. No target converts Darija.

### C3. The context prompt seeds and reinforces invention

`services/ai/src/mawiid_ai/stt/whisper_engine.py` passes the tail of the previous final back to Whisper as `initial_prompt` (`context_chars`, default 200), with `condition_on_previous_text=False`.

On uncertain dialect audio, an MSA prompt is not neutral: Whisper completes the prompt instead of transcribing. Once one wrong MSA phrase lands, it becomes the prompt for the next phrase. `repeats_context()` only catches an **exact** echo of the prompt's tail, so a paraphrase passes through and the loop continues.

### C4. Short, quiet segments are the worst case for Whisper

`services/ai/src/mawiid_ai/stt/vad.py` ends a phrase after 500 ms of silence and force-cuts at 6 s. On dialect speech, Silero VAD is less certain, so segments become short, quiet, and frequently cut mid-word. On CPU, `whisper_engine.pad_to_phrase()` pads short phrases to a minimum of 1000 frames (about 10 s) of mostly silence before encoding. Short audio + silence padding + an MSA prompt is the classic hallucination recipe.

### C5. The hallucination filter does not model Arabic invention

`services/ai/src/mawiid_ai/stt/postprocess.py` only rejects:

- stock credit lines, including `شكرا`, `شكرا لكم`, `شكرا للمشاهدة`, `ترجمة نانسي قنقر`, `اشتركوا في القناة`;
- stretched letters (`Sssssss`);
- one word repeated three or more times (`سر. سر. سر.`);
- an exact echo of the prompt tail.

A plausible MSA sentence invented from a Darija phrase satisfies none of these conditions. There is also no check that the text length is plausible for the audio duration, which is the cheapest and most language-agnostic signal available.

### C6. Detection cannot distinguish the two Arabic variants

`whisper_engine.pick_language()`:

```python
by_code[ALL_LANGUAGES[current].model_code] = current  # ar-SA and ar-MA share "ar": keep the speaker's
```

This line is deliberate and correct as a safety rule — but it means that a stream opened as `ar-SA` can never become `ar-MA`, because Whisper reports a single `"ar"` probability for both. With "I speak: Auto" (the default), a Darija speaker stays on stock Whisper for the whole call. Routing to the Darija engine is only possible when the speaker declares Darija before the first phrase — and the frontend currently provides no control to declare a **spoken** language at all (see B1).

### C7. The second failure: no translation happens

`services/ai/src/mawiid_ai/agent/worker.py` catches the translator build failure and continues:

```python
log.warning("no translation model, captions stay in the spoken language: %s", exc)
translator = None
```

With `data/models/madlad400-3b-mt-ct2` absent, every listener reads the original text regardless of their chosen language. Separately, the README already documents that MADLAD's `<2ary>` tag returns lossy MSA and that Darija→Arabic output changed meaning in testing. Translation is a **third** source of wrongness once the model is restored; it must not be confused with the STT defect.

## 4. Confirm the diagnosis in five minutes

1. Start the worker and read the first log lines. Expect `no darija model at ...` and `no translation model, captions stay in the spoken language`.
2. Join a room, speak Darija, and compare the caption with what you said. If the caption is grammatical MSA, C1 is confirmed.
3. Set `MAWIID_STT_CONTEXT_CHARS=0`, restart, and repeat. Fewer invented continuations means C3 is confirmed.
4. Set `MAWIID_STT_WHISPER_MODEL=medium` (or `large-v3`) and repeat. Clear improvement means the checkpoint is part of the problem, not just the routing.

Do not start coding before running at least steps 1–3.

## 5. Fix plan

Order matters: A1–A3 change the engine, A4–A5 make it observable, B1–B3 give users a way to declare Darija. Do not start with the frontend; it can only select a language the engine can actually route.

### Part A — `services/ai`

#### A1. Per-language Whisper profile instead of global settings

Give `Language` optional overrides so tuning is data, not code branches.

`services/ai/src/mawiid_ai/stt/config.py`:

```python
@dataclass(frozen=True, slots=True)
class Language:
    model_code: str
    script: str | None = None
    context_chars: int | None = None  # None: use WhisperSettings.context_chars
    no_speech_prob: float | None = None  # None: use WhisperSettings.max_no_speech_prob
    min_logprob: float | None = None  # None: use WhisperSettings.min_avg_logprob
```

Set Arabic to disable the prompt and tighten the confidence gates:

```python
"ar-SA": Language("ar", context_chars=0, no_speech_prob=0.45, min_logprob=-0.9),
"ar-MA": Language("ar", context_chars=0, no_speech_prob=0.45, min_logprob=-0.9),
```

All other languages keep `None` and therefore today's behaviour.

`services/ai/src/mawiid_ai/stt/whisper_engine.py`:

- In `WhisperStream.__init__`, resolve the profile once for its language and store it (`self._context_chars`, `self._no_speech_prob`, `self._min_logprob`). Read `LANGUAGES` through the module-level name so existing tests that monkeypatch `whisper_engine.LANGUAGES` keep working.
- In `_final`, replace `self._engine.settings.context_chars` with `self._context_chars`; skip prompt maintenance entirely when it is `0`.
- In `WhisperEngine.transcribe`, use the per-language `no_speech_threshold` and `log_prob_threshold` when set, falling back to the settings values.

Arabic keeps working when the prompt is off: `repeats_context` becomes a no-op because the context is empty, which is intended.

#### A2. Add a language-agnostic length-plausibility guard

In `services/ai/src/mawiid_ai/stt/postprocess.py`:

```python
MAX_CHARS_PER_SECOND = 30.0


def implausible_length(text: str, audio_seconds: float) -> bool:
    """True when the text is far longer than anyone could say in that audio."""
    if audio_seconds <= 0.2:
        return False
    return len(text) / audio_seconds > MAX_CHARS_PER_SECOND
```

Call it from `WhisperStream._final` after `transcribe` returns a non-empty text, using the length of the segment audio in seconds. Drop the result when it returns `True`. Thirty characters per second is well above normal speech in every enabled language; it catches invented paragraphs without cutting fast speakers.

#### A3. Drop repeated finals from the same speaker

Whisper loops on silence. In `WhisperStream`, keep a `deque(maxlen=2)` of the last finals **as normalized text**. In `_final`, drop a result when it equals the previous final **and** is at least 20 characters long. Short legitimate repeats (`نعم`, `oui`) stay allowed.

Use the same normalization helper as `postprocess._normalized` (expose it as `normalize_for_compare` rather than importing a private name).

#### A4. Enable Darija as a first-class language, and make absence loud

`services/ai/src/mawiid_ai/stt/config.py`:

```python
_DEFAULT_ENABLED = "en-US,fr-FR,ar-SA,ar-MA"
```

`services/ai/src/mawiid_ai/stt/factory.py`:

- When `ar-MA` is enabled but the model file is missing, log at **ERROR** with the exact command to run: `make ai-models-darija` (added in C1), and state the consequence literally: `ar-MA falls back to stock Whisper and will be transcribed as Standard Arabic (inaccurate)`.
- Add `def engine_report(engines) -> dict[str, list[str]]` returning the loaded engine chain per enabled language, and log it once at startup from `agent/worker.py`. One line per language, for example `ar-MA: whisper-darija, whisper`. This is the change that makes the system "look clean" in operation: routing is inspectable without reading code.
- When an Arabic language is enabled while `WhisperSettings.model` is the default `small`, log a warning recommending `medium` or `large-v3`. Do not change the default: CPU-only machines depend on `small`.

#### A5. Keep the shared-code rule, and document the limitation

Do **not** make `pick_language` invent `ar-MA`: Whisper cannot distinguish it, and a heuristic that guesses would produce worse failures than the current behaviour. Instead:

- Add a comment next to the existing shared-code line stating that dialect routing is the speaker's responsibility, and why.
- Update the `pick_language` docstring to say that languages sharing a `model_code` are never switched between, so `ar-MA` is reachable only by declaration.
- Ensure `pipeline.mawiid_language("ar-MA")` returns `"ar-MA"` once `ar-MA` is in `LANGUAGES` (the exact-match loop already does this; extend `tests/test_pipeline.py` to pin it).

### Part B — `frontend`

The backend and the agent already support a spoken language: `PATCH /participant` accepts `participant_spoken_language`, the backend writes the `mawiid.spoken_language` attribute, and `RoomPipeline` reads it with `AUTO` as the default (`apps/backend/src/module/main/participants/integration.md`, section 6). The client simply never sends it. Fixing the client is therefore small and needs no backend change.

#### B1. Add an "I speak" picker

`frontend/src/pages/meetRoomPage/components/MeetControls.jsx`:

```js
const LANGUAGE_CODES = {
    English: 'en',
    Arabic: 'ar',
    'Darija (Moroccan Arabic)': 'ar-MA',
    French: 'fr',
};

const SPOKEN_CODES = {
    Auto: 'auto',
    ...LANGUAGE_CODES,
};
```

- Uncomment Darija; leave Chinese commented unless `MAWIID_LANGUAGES` enables `zh-CN`/`zh-TW` as well. The lists must match the worker or users pick a language that silently returns originals.
- Add `spokenLanguage` and `onSpokenLanguageChange` props, and render a second `languageSection('I speak', ...)` using `SPOKEN_CODES`. Reuse the existing section component so the popup style stays consistent; do not restyle the menu.
- `languageName()` must return `'Auto'` for the `'auto'` code and must keep matching the **full** code first, so `ar-MA` displays as Darija rather than Arabic.
- Keep `handleLanguageChange` for the reading language; add a separate handler for the spoken one. Do not merge them: reading and speaking are different settings and the worker uses them differently.

`frontend/src/hooks/useRoom.js`:

```js
const setSpokenLanguage = useCallback(
    (language) => updateSelf({ participant_spoken_language: language }),
    [updateSelf],
);
```

Export it next to `setLanguage`. The backend accepts `"auto"` and the short or full codes.

`frontend/src/pages/meetRoomPage/meetRoomPage.jsx`: pass `spokenLanguage` and `onSpokenLanguageChange={room.setSpokenLanguage}` through to `MeetControls` alongside the existing `onLanguageChange`.

#### B2. Do not lie about availability

The popup currently lets a user pick a language the worker may not handle; they then see the original text with no explanation. Keep the behaviour, but make it explicit in the UI copy: when the selected caption language differs from the caption's `mawiid.language` and no translation arrives within a few seconds, show a one-line notice in the captions panel ("Translation is unavailable for this language right now — showing the original"). Implement it in `frontend/src/hooks/useRoom.js`, where captions are assembled and where a caption is already marked `foreign` while its translation is in progress, then pass an optional `notice` string down to `MeetCaptions`. That component stays presentational: no timers and no language logic in the view. Do not block the picker.

#### B3. Keep the frontend dumb about models

Do not add model names, environment checks or "Darija is broken" banners to the client. The client's only jobs are: offer the same codes the worker supports, send both settings, and display whatever captions arrive. Everything about engines stays server-side.

### Part C — operations and documentation

#### C1. Add the missing model target

`Makefile`, next to `ai-models`:

```make
ai-models-darija: ## Convert the Darija Whisper model (needed while ar-MA is enabled)
	cd $(AI) && .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu && \
		.venv/bin/pip install -e ".[convert]" && \
		.venv/bin/python scripts/convert_darija_model.py --model turbo
```

Use `--model turbo` (`anaszil/whisper-large-v3-turbo-darija`, MIT, reported WER 24.9 / CER 8.3 on its own held-out set) rather than `medium`; higher accuracy on dialect at comparable size.

#### C2. Update `services/ai/README.md`

Three additions, no rewrites:

- A short "Arabic and Darija accuracy" subsection stating that stock Whisper is MSA-biased, that Darija requires the converted model plus an explicit spoken-language choice, and that `small` is not adequate for Arabic.
- Document the per-language prompt behaviour (Arabic disables the prompt) and that `MAWIID_STT_CONTEXT_CHARS` no longer applies to `ar-SA`/`ar-MA`.
- Replace the `make ai-models` reference in the Darija section with `make ai-models-darija`.

## 6. Tests to add

| File                                                   | Test                                                                | Asserts                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `services/ai/tests/test_pipeline.py`                   | `test_darija_is_its_own_language_when_enabled`                       | `mawiid_language("ar-MA") == "ar-MA"` with `ar-MA` enabled               |
| `services/ai/tests/test_routes.py`                     | `test_darija_loads_its_engine_when_enabled_and_present`              | `router.open_stream("ar-MA").engine == "whisper-darija"`                 |
| `services/ai/tests/test_language_detection.py`         | `test_detection_never_switches_between_arabic_variants`              | `pick_language({"ar": 0.99}, "ar-SA", [...], 0.7) == "ar-SA"` (unchanged, now pinned) |
| `services/ai/tests/test_whisper_context.py`            | `test_arabic_streams_do_not_prompt_with_previous_text`               | `transcribe` receives `context=""` for `ar-SA` after a first final       |
| `services/ai/tests/test_whisper_context.py`            | `test_french_streams_keep_the_prompt`                                | non-Arabic languages still receive the context                           |
| `services/ai/tests/test_postprocess.py`                | `test_implausible_length_is_rejected`                                | 200 characters from 1 s of audio is a hallucination; 40 normal chars is not |
| `services/ai/tests/test_whisper_context.py`            | `test_identical_long_final_twice_is_dropped`                         | the second identical final ≥ 20 chars yields no result                   |

Follow the existing style: no fixtures beyond `conftest.py`, fakes rather than models, and skip marks via `needs_languages(...)` for anything that requires `ar-MA` to be enabled.

## 7. Acceptance criteria

1. `cd services/ai && .venv/bin/python -m pytest` passes, including the new tests and the existing real-audio tests that the machine can run.
2. `cd frontend && bun run build` succeeds.
3. With `MAWIID_LANGUAGES` containing `ar-MA` and the model converted, startup logs one routing line per language and names `whisper-darija` for `ar-MA`.
4. With `ar-MA` enabled but the model missing, startup logs an ERROR naming the command to run and the exact consequence. No silent fallback.
5. A guest who selects "I speak: Darija" is transcribed by `whisper-darija`; verified from the routing log, not from the caption text.
6. An Arabic phrase's Whisper call carries no `initial_prompt`; a French phrase still does.
7. A fabricated paragraph over a one-second segment is dropped before publishing.
8. No public API, event name, attribute or contract changes.

## 8. Do not

- Do not switch the pipeline to a cloud STT or translation provider. The service is deliberately sovereign (`services/ai/README.md`); cloud models are a product decision, not a bug fix.
- Do not replace Whisper for English and French. Their quality is measured and good; only the Arabic path is defective.
- Do not make `pick_language` guess Darija from an `"ar"` probability. It cannot, and a guess is worse than a declaration.
- Do not weaken `is_hallucination` or remove the compression-ratio filter to "reduce false drops". Tune with tests, not by deletion.
- Do not restyle the caption popup or the control bar while adding the spoken-language section.
- Do not touch `apps/backend` or `packages/contracts`. The attribute and DTO already exist.

## 9. Reference

| Item                       | Value                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| Enabled languages          | `MAWIID_LANGUAGES`, default `en-US,fr-FR,ar-SA,ar-MA` after this change  |
| Whisper model              | `MAWIID_STT_WHISPER_MODEL`, default `small`; use `medium`/`large-v3` for Arabic |
| Darija model               | `MAWIID_STT_DARIJA_MODEL`, default `data/models/whisper-darija-ct2`      |
| Translation model          | `MAWIID_MT_MODEL_PATH`, default `data/models/madlad400-3b-mt-ct2`       |
| Spoken language attribute  | `mawiid.spoken_language`, `auto` when empty                             |
| Reading language attribute | `mawiid.language`                                                       |
| Caption topics             | `lk.transcription`, `mawiid.translation.v1`                             |
| Agent                      | `LIVEKIT_TRANSLATOR_AGENT`, default `mawiid-translator`                 |

Related documents: `services/ai/README.md` (pipeline behaviour), `docs/live-chat-plan.md` section 11 (translation design), `apps/backend/src/module/main/participants/integration.md` section 6 (participant attributes).
