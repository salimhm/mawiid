# Adding Darija: review of `ai-darija-hallucination.md`

_2026-11-10 · Reviewed against the code on branch `live_translation`_

This reviews the brief `ai-darija-hallucination.md`, with adding Darija (`ar-MA`) to the website as the goal. The brief is right about why Darija comes out wrong: stock Whisper turns it into Standard Arabic (MSA). But it gets this machine's setup wrong, misses how Darija and Arabic listeners see each other, and makes the job sound bigger than it is.

## 1. Darija mostly works already

### The model is already on this machine

The brief (C2, C7) says `services/ai/data/` is missing. It isn't:

| Model | Path | Size | Status |
| --- | --- | --- | --- |
| Darija STT | `services/ai/data/models/whisper-darija-ct2` | 782 MB | Converted. It's the `turbo` version (`feature_size: 128`, the large-v3 audio format), as the brief recommends. |
| Translation | `services/ai/data/models/madlad400-3b-mt-ct2` | 2.8 GB | Converted. |

So the "missing model" part of the diagnosis is wrong for this machine. The "nothing is translated" symptom needs a fresh look at the worker logs.

### You don't need a new picker to reach the Darija model

The brief says the Darija engine can't be reached because the UI has no way to declare a spoken language. In fact, when someone's spoken language is "Auto", the worker starts transcribing in their caption language:

```python
# services/ai/src/mawiid_ai/agent/pipeline.py:217-219
picked = self._spoken_languages.get(identity)
language = picked or self._languages.get(identity) or DEFAULT_LANGUAGE
detect = picked is None
```

The Darija engine is loaded with `languages=["ar-MA"]` (`factory.py:43`). A stream on that engine has only one language to choose from, so detection is off (`whisper_engine.py:210-212`) and the speaker stays on the Darija model.

That makes the minimum change two lines:

1. Add `ar-MA` to `MAWIID_LANGUAGES` (in `.env`, or `_DEFAULT_ENABLED` in `services/ai/src/mawiid_ai/stt/config.py:30`).
2. Uncomment `'Darija (Moroccan Arabic)': 'ar-MA'` in `frontend/src/pages/meetRoomPage/components/MeetControls.jsx:11`.

A user who picks "Show captions in: Darija" is then transcribed by `whisper-darija`. Nothing else needs to change for that:

- **Backend:** accepts the full code. The DTO pattern is `^(auto|[a-z]{2,3}(-[A-Z]{2})?)$`.
- **Worker:** `mawiid_language("ar-MA")` returns `"ar-MA"` as soon as `ar-MA` is enabled.
- **Frontend:** `languageName()` checks the full code first (`MeetControls.jsx:30`), so the picker shows "Darija" rather than "Arabic".

This is the change that removes most of the Darija hallucination. Do it first and test it before anything else.

The "I speak" picker (B1 in the brief) is still useful, for someone who speaks Darija but wants captions in French or English. It's a second step, not a requirement.

## 2. What the brief misses

### How Darija and Arabic listeners see each other

`ar-SA` and `ar-MA` share the Whisper code `ar`. The translator gives a listener the original text when the codes match:

```python
# services/ai/src/mawiid_ai/translation/translator.py:65
if LANGUAGES[target].model_code == spoken:
```

MADLAD is also asked for `<2{model_code}>`, which is `<2ar>` for Darija (`madlad_engine.py:54`). As a result:

| Speaker | Listener | What the listener reads |
| --- | --- | --- |
| Darija | Arabic (`ar-SA`) | The Darija text as spoken, not converted to Standard Arabic |
| Arabic (`ar-SA`) | Darija | The Standard Arabic text as spoken |
| French or English | Darija | Standard Arabic (MADLAD `<2ar>`), not Darija |
| Darija | French or English | MADLAD translation from Arabic. The README notes Darija→Arabic changed meaning in testing. |

Each of these may be acceptable, but they're product decisions to make on purpose. A UI label "Darija (Moroccan Arabic)" suggests the third row gives real Darija output, which it doesn't.

### There's no Darija test audio

`services/ai/data/samples/` only has `ar-SA`, `en-US` and `fr-FR`. Without a few recorded Darija clips, nobody can measure whether the brief's fixes help or hurt. The clips should include French mixed in, as Darija speakers really talk.

## 3. Problems in the proposed fixes

### A1: one setting would make things worse

Turning off the context prompt for Arabic (`context_chars=0`) is sound.

Changing `min_logprob` from -1.0 to -0.9 is not. In faster-whisper, `log_prob_threshold` doesn't drop low-confidence text. It triggers retries at higher temperature, and `_transcribe` retries at `[0.0, 0.2, 0.4, 0.6]` (`whisper_engine.py:170`). A stricter threshold means more sampling at higher temperature, which invents more text and adds delay.

To filter on confidence, check `segment.avg_logprob` in the `kept` filter, next to `no_speech_prob` (`whisper_engine.py:179-183`).

The values 0.45 and -0.9 are also made up with no measurement behind them. Section 8 of the brief says "tune with tests"; that needs the Darija clips from section 2.

### A2: the length check must use the real phrase length

On CPU, `pad_to_phrase()` pads short phrases to about 10 s. If `audio_seconds` comes from the padded audio, the check never triggers. It must be the length of the phrase the VAD cut. Also, 30 characters per second is loose for a 1 s phrase: an invented 25-character phrase still gets through.

### A3: a `deque` isn't needed

The check only compares against the previous final, so one stored string does the job.

### A4: the `small` warning doesn't affect Darija

The Darija engine has its own settings (`settings.darija`) and always runs the converted turbo model. The warning about `WhisperSettings.model = "small"` only matters for `ar-SA`.

### B2: separate task

The "translation unavailable" notice doesn't fix hallucination and isn't specific to Darija. Track it separately.

### Duplicate labels

Causes C1–C7 and the Part C sections C1–C2 share names, so "`make ai-models-darija` (added in C1)" is ambiguous. Rename Part C to D1/D2.

## 4. Verdict per item

| Item | Verdict |
| --- | --- |
| A1: no context prompt for Arabic | **Keep.** |
| A1: `no_speech_prob` / `min_logprob` overrides | **Change.** Drop `min_logprob`, filter on `avg_logprob`, measure the values on recorded clips. |
| A2: length check | **Keep**, using the real phrase length. |
| A3: drop repeated finals | **Keep**, with a single string instead of a `deque`. |
| A4: turn on `ar-MA`, ERROR log when the model is missing, routing line at startup | **Keep.** The most useful item, since silent fallback is the real risk on other machines. |
| A4: `small` warning | Keep for `ar-SA`; it doesn't affect Darija. |
| A5: never guess Darija from `"ar"` | **Keep.** |
| B1: "I speak" picker | **Keep as phase 2.** |
| B2: "translation unavailable" notice | **Separate task.** |
| B3: keep the frontend unaware of models | **Keep.** |
| C1 (Part C): `make ai-models-darija` | **Keep**, for other machines and new installs. |
| C2 (Part C): README updates | **Keep.** |
| Causes C2 and C7 | **Fix the text.** Both models are present on this machine. |

## 5. Suggested order

1. **Turn Darija on.** Add `ar-MA` to `MAWIID_LANGUAGES` and uncomment Darija in `MeetControls.jsx`. Record 5–10 Darija clips (some with French mixed in) and check the captions. Check the routing from the logs, not from how the captions read.
2. **Make failures visible.** Add the A4 ERROR log, the startup routing line, and the `make ai-models-darija` target.
3. **Decide how Darija and Arabic listeners see each other** (section 2), and change the UI label if Darija listeners will read Standard Arabic.
4. **Reduce invented text.** A1 (prompt only, plus an `avg_logprob` filter), A2 and A3, each measured on the recorded clips before and after.
5. **Add the "I speak" picker** (B1), for people who speak Darija but read captions in another language.

## 6. Tests

Keep the tests listed in the brief, with these changes:

- `test_implausible_length_is_rejected`: also test that a short phrase padded to about 10 s is still rejected.
- Add a test that a stream opened as `ar-MA` on the `whisper-darija` engine has detection turned off.
- Add a test for each listener case in the section 2 table, once the expected behaviour is decided.
- Add Darija samples under `services/ai/data/samples/ar-MA/` and point `test_darija_integration.py` at them.
