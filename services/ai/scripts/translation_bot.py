"""Translation test bots: checks live translation end to end, with no human speaking.

One bot per language speaks real recorded sentences (FLEURS clips) into a LiveKit room, one at
a time, and one listener bot per language reads the captions, exactly as people in a meeting
would. The real mawiid-translator worker is dispatched to the room, so the whole path is tested:
LiveKit -> worker -> Whisper -> MADLAD -> LiveKit -> each listener.

FLEURS reads the same sentences in every language, so every caption is scored against a human
reference instead of being judged by ear:

  speech-to-text   the listener of the spoken language gets the original text:
                   word error rate (WER) against the clip's transcript (CER for Chinese)
  translation      every other listener gets a translation: chrF and BLEU against the same
                   sentence's reference in that language (0-100, higher is better)
  delivery         every listener got a caption, in their language and script, and how long
                   after the end of the sentence the last piece of it arrived

Pass: every caption delivered in the right language, mean WER per language <= --max-wer and
chrF per direction >= --min-chrf. The floors are set to catch broken output (wrong language,
garbage, nothing at all), not to grade quality: for reference, text-only translation scores a
mean chrF of 54 on these sentences (README), and speech errors lower it further.

    make test_bot                                    # with make dev running
    make test_bot TEST_BOT_ARGS="--clips 10 --auto-detect"

    LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \\
    python scripts/translation_bot.py --languages fr-FR en-US ar-SA --clips 5

--auto-detect puts speakers on "I speak: Auto", so language detection is tested too.
--rescore <run dir> scores a finished run again from its saved captions (no LiveKit needed).
Only clips with reference translations are used: fetch_samples.py --per-language 30 gives more.

Writes <out>/results.json, clips.csv and report.md (every sentence with what was heard and what
each listener read, next to the references). Exit code 0: pass, 1: fail, 2: could not run.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import sys
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import sacrebleu
from livekit import rtc

sys.path.insert(0, str(Path(__file__).resolve().parent))
from benchmark import SAMPLES_DIR, error_rate, load_audio, normalize  # noqa: E402
from room_loadtest import FRAME, SAMPLE_RATE, TOPICS, dispatch, token, trim_silence  # noqa: E402

PARALLEL = Path(__file__).resolve().parent.parent / "data" / "translation" / "parallel.jsonl"
SCRIPTS = {"ar": "ARABIC", "zh": "CJK", "en": "LATIN", "fr": "LATIN", "es": "LATIN", "de": "LATIN"}


@dataclass
class Caption:
    t: float
    topic: str
    language: str
    track: str
    text: str


@dataclass
class Sentence:
    sentence_id: str
    language: str
    audio: np.ndarray
    reference: str  # transcript in the spoken language
    references: dict[str, str]  # the same sentence in every language


@dataclass
class Listener:
    language: str
    room: rtc.Room
    finals: list[Caption] = field(default_factory=list)


def pct(value: float | None) -> str:
    return "–" if value is None else f"{value:.0%}"


def script_ok(text: str, language: str) -> bool:
    """Most letters are in the script the language is written in (catches untranslated output)."""
    expected = SCRIPTS.get(language.split("-")[0])
    letters = [ch for ch in text if ch.isalpha()]
    if not expected or not letters:
        return bool(letters) or not expected
    hits = sum(1 for ch in letters if expected in unicodedata.name(ch, ""))
    return hits / len(letters) >= 0.6


def load_sentences(languages: list[str], per_language: int) -> list[Sentence]:
    if not PARALLEL.exists():
        raise SystemExit(f"{PARALLEL} is missing: run scripts/fetch_samples.py --languages {' '.join(languages)}")
    parallel = [json.loads(line) for line in PARALLEL.read_text(encoding="utf-8").splitlines() if line.strip()]
    sentences = []
    for language in languages:
        manifest = SAMPLES_DIR / language / "manifest.jsonl"
        if not manifest.exists():
            raise SystemExit(f"no clips for {language}: run scripts/fetch_samples.py --languages {' '.join(languages)}")
        by_text = {row[language]: row for row in parallel if row.get(language)}
        count = 0
        for line in manifest.read_text(encoding="utf-8").splitlines():
            entry = json.loads(line)
            row = by_text.get(entry["text"])
            if row is None or not all(row.get(other) for other in languages):
                continue  # no reference translation for this clip
            audio = trim_silence(load_audio(SAMPLES_DIR / language / entry["audio"]))
            sentences.append(Sentence(row["id"], language, (np.clip(audio, -1, 1) * 32767).astype(np.int16),
                                      entry["text"], {k: row[k] for k in languages}))
            count += 1
            if count >= per_language:
                break
        if count == 0:
            raise SystemExit(f"no {language} clip has reference translations: run scripts/fetch_samples.py --per-language 20")
    return sentences


class Speaker:
    """A bot that talks: sends 20 ms frames at real-time pace, silence when it has nothing to say."""

    def __init__(self, room: rtc.Room, source: rtc.AudioSource, track_sid: str) -> None:
        self.room, self.source, self.track_sid = room, source, track_sid
        self.clock = time.monotonic()
        self.silence = np.zeros(FRAME, dtype=np.int16)

    async def send(self, frame: np.ndarray) -> None:
        if len(frame) < FRAME:
            frame = np.concatenate([frame, self.silence[: FRAME - len(frame)]])
        self.clock = max(self.clock, time.monotonic() - 0.2) + FRAME / SAMPLE_RATE
        wait = self.clock - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        await self.source.capture_frame(rtc.AudioFrame(frame.tobytes(), SAMPLE_RATE, 1, FRAME))

    async def say(self, audio: np.ndarray) -> None:
        for start in range(0, len(audio), FRAME):
            await self.send(audio[start : start + FRAME])

    async def quiet(self, seconds: float) -> None:
        for _ in range(int(seconds * 50)):
            await self.send(self.silence)


async def join(room_name: str, identity: str, reads: str, speaks: str, captions: bool) -> rtc.Room:
    room = rtc.Room()
    attributes = {"mawiid.language": reads, "mawiid.spoken_language": speaks,
                  "mawiid.translation_enabled": "true" if captions else "false"}
    await room.connect(os.environ["LIVEKIT_URL"], token(identity, room_name, attributes))
    return room


def listen(listener: Listener, started: float) -> None:
    def handler(topic: str):
        def on_stream(reader: rtc.TextStreamReader, sender: str) -> None:
            async def read() -> None:
                try:
                    text = await reader.read_all()
                except Exception:
                    return
                attrs = dict(reader.info.attributes or {})
                if attrs.get("lk.transcription_final") == "true":
                    listener.finals.append(Caption(time.monotonic() - started, topic, attrs.get("mawiid.language", ""),
                                                   attrs.get("lk.transcribed_track_id", ""), text))
            asyncio.ensure_future(read())
        return on_stream

    for topic in TOPICS:
        listener.room.register_text_stream_handler(topic, handler(topic))


async def speak_and_collect(speaker: Speaker, audio: np.ndarray, listeners: list[Listener], started: float,
                            settle_s: float, timeout_s: float) -> tuple[float, dict[str, list[Caption]]]:
    """Plays one sentence, then keeps sending silence until every listener has its caption(s)."""
    marks = {l.language: len(l.finals) for l in listeners}
    await speaker.say(audio)
    ended = time.monotonic() - started

    def new(l: Listener) -> list[Caption]:
        return [c for c in l.finals[marks[l.language]:] if c.track == speaker.track_sid]

    # At least the worker's 1.5 s hold plus the 0.5 s pause that ends a phrase, so it never joins
    # the end of this sentence with the next one.
    await speaker.quiet(2.5)
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        await speaker.quiet(0.25)
        got = [new(l) for l in listeners]
        last = max((c.t for g in got for c in g), default=None)
        # Every listener got a caption after the sentence ended (a long sentence is captioned in
        # parts while it is spoken, so earlier parts do not count) and nothing new came for settle_s.
        done = all(any(c.t >= ended for c in g) for g in got)
        if done and last is not None and time.monotonic() - started - last >= settle_s:
            break
    return ended, {l.language: new(l) for l in listeners}


def grams(text: str, language: str) -> set[str]:
    norm = normalize(text, language)
    return {norm[i : i + 3] for i in range(max(0, len(norm) - 2))}


def align(captions: list[Caption], spans: list[tuple[float, str]], language: str) -> list[list[Caption]]:
    """Assigns each caption of one speaker, in arrival order, to one of the sentences that speaker
    said, in order (monotone), maximizing text overlap with each sentence's reference. A caption
    cannot belong to a sentence that started after it arrived, and leans towards the sentence
    spoken just before it (a long earlier sentence shares common letter groups with anything, so
    it only wins when the text clearly matches it). Returns the captions per sentence."""
    n = len(spans)
    groups: list[list[Caption]] = [[] for _ in range(n)]
    if not captions or not n:
        return groups
    neg = float("-inf")
    refs = [grams(ref, language) for _, ref in spans]
    score = []
    for c in captions:
        g = grams(c.text, language)
        weight = max(1, len(g))
        latest = max((j for j in range(n) if spans[j][0] <= c.t), default=-1)
        row = []
        for j in range(n):
            if c.t < spans[j][0]:
                row.append(neg)
                continue
            # Matching letter groups, plus a prior on time: the latest sentence gets a bonus, the
            # one before it nothing, older ones a penalty (a caption is rarely that late).
            prior = 0.3 if j == latest else 0.0 if j == latest - 1 else -0.5
            row.append(len(g & refs[j]) + prior * weight)
        score.append(row)
    best = [[neg] * n for _ in captions]
    back = [[0] * n for _ in captions]
    for j in range(n):
        best[0][j] = score[0][j]
    for i in range(1, len(captions)):
        run_best, run_arg = neg, 0
        for j in range(n):
            if best[i - 1][j] > run_best:
                run_best, run_arg = best[i - 1][j], j
            best[i][j] = score[i][j] + run_best if run_best > neg and score[i][j] > neg else neg
            back[i][j] = run_arg
    j = max(range(n), key=lambda k: best[-1][k])
    if best[-1][j] == neg:  # nothing fits the time order (should not happen): put everything on the last sentence
        groups[-1] = list(captions)
        return groups
    for i in range(len(captions) - 1, -1, -1):
        groups[j].insert(0, captions[i])
        j = back[i][j]
    return groups


def build_results(played, warmup: Sentence, listeners: list[Listener], speakers: dict[str, "Speaker"], args) -> list[dict]:
    """Matches every caption to the sentence it belongs to, then scores each sentence."""
    per_sentence: dict[int, dict[str, list[Caption]]] = {}  # index in played -> listener language -> captions
    for language, speaker in speakers.items():
        spoken = [(k, p) for k, p in enumerate(played) if (p[0].language if p[0] else warmup.language) == language]
        for listener in listeners:
            captions = sorted((c for c in listener.finals if c.track == speaker.track_sid), key=lambda c: c.t)
            refs = [(p[2], p[0].references[listener.language] if p[0] else warmup.references[listener.language]) for _, p in spoken]
            for (k, _), group in zip(spoken, align(captions, refs, listener.language)):
                per_sentence.setdefault(k, {})[listener.language] = group
    results = []
    for k, (sentence, _, _, ended) in enumerate(played):
        if sentence is None:
            continue
        got = per_sentence.get(k, {})
        heard_caps = got.get(sentence.language, [])
        heard = " ".join(c.text.strip() for c in heard_caps) if heard_caps else None
        row = {"sentence_id": sentence.sentence_id, "language": sentence.language, "reference": sentence.reference,
               "heard": heard, "wer": round(error_rate(sentence.reference, heard, sentence.language), 3) if heard else None,
               "transcript_latency_s": round(max(c.t for c in heard_caps) - ended, 2) if heard_caps else None,
               "translations": {}}
        if args.auto_detect:
            row["detected_ok"] = bool(heard_caps) and all(c.language == sentence.language for c in heard_caps)
        for listener in listeners:
            if listener.language == sentence.language:
                continue
            caps = got.get(listener.language, [])
            text = " ".join(c.text.strip() for c in caps) if caps else None
            ref = sentence.references[listener.language]
            row["translations"][listener.language] = {
                "text": text, "reference": ref,
                "chrf": round(sacrebleu.sentence_chrf(text, [ref]).score, 1) if text else None,
                "latency_s": round(max(c.t for c in caps) - ended, 2) if caps else None,
                "language_ok": bool(caps) and all(c.language == listener.language for c in caps if c.topic != TOPICS[0])
                               and script_ok(text, listener.language),
                "fallback_original": any(c.topic == TOPICS[0] for c in caps),
            }
        results.append(row)
        chrfs = [o["chrf"] for o in row["translations"].values() if o["chrf"] is not None]
        print(f"{sentence.language} {sentence.sentence_id}: WER {pct(row['wer']):>4}  chrF {' '.join(f'{c:.0f}' for c in chrfs) or '–'}  "
              f"missing {sum(1 for o in row['translations'].values() if o['text'] is None)}", flush=True)
    return results


def score(sentences: list[Sentence], results: list[dict], languages: list[str], args) -> dict:
    stt: dict[str, list[float]] = {}
    directions: dict[str, dict] = {}
    for r in results:
        src = r["language"]
        if r["heard"] is not None:
            stt.setdefault(src, []).append(r["wer"])
        for tgt, out in r["translations"].items():
            d = directions.setdefault(f"{src}→{tgt}", {"hyps": [], "refs": [], "delivered": 0, "total": 0, "wrong_language": 0,
                                                       "untranslated": 0, "latency": []})
            d["total"] += 1
            if out["text"] is None:
                continue
            d["delivered"] += 1
            d["hyps"].append(out["text"])
            d["refs"].append(out["reference"])
            d["latency"].append(out["latency_s"])
            d["wrong_language"] += 0 if out["language_ok"] else 1
            d["untranslated"] += 1 if out["fallback_original"] else 0
    summary_dirs = {}
    for name, d in directions.items():
        tgt = name.split("→")[1]
        tokenize = "zh" if tgt.startswith("zh") else "13a"
        chrf = sacrebleu.corpus_chrf(d["hyps"], [d["refs"]]).score if d["hyps"] else 0.0
        bleu = sacrebleu.corpus_bleu(d["hyps"], [d["refs"]], tokenize=tokenize).score if d["hyps"] else 0.0
        summary_dirs[name] = {"sentences": d["total"], "delivered": d["delivered"], "chrf": round(chrf, 1), "bleu": round(bleu, 1),
                              "wrong_language": d["wrong_language"], "untranslated": d["untranslated"],
                              "latency_p50_s": round(float(np.percentile(d["latency"], 50)), 2) if d["latency"] else None,
                              "latency_max_s": round(float(np.max(d["latency"])), 2) if d["latency"] else None}
    summary_stt = {}
    for language in languages:
        spoken = [r for r in results if r["language"] == language]
        wers = stt.get(language, [])
        summary_stt[language] = {"sentences": len(spoken), "delivered": len(wers),
                                 "wer": round(float(np.mean(wers)), 3) if wers else None,
                                 "language_detected_ok": sum(1 for r in spoken if r.get("detected_ok")) if args.auto_detect else None}
    problems = []
    for language, s in summary_stt.items():
        if s["delivered"] < s["sentences"]:
            problems.append(f"{language}: {s['sentences'] - s['delivered']} sentence(s) without transcript")
        if s["wer"] is not None and s["wer"] > args.max_wer:
            problems.append(f"{language}: WER {s['wer']:.0%} > {args.max_wer:.0%}")
    for name, s in summary_dirs.items():
        if s["delivered"] < s["sentences"]:
            problems.append(f"{name}: {s['sentences'] - s['delivered']} translation(s) never arrived")
        if s["wrong_language"]:
            problems.append(f"{name}: {s['wrong_language']} caption(s) in the wrong language or script")
        if s["untranslated"]:
            problems.append(f"{name}: {s['untranslated']} caption(s) left untranslated (worker fell back to the original)")
        if s["delivered"] and s["chrf"] < args.min_chrf:
            problems.append(f"{name}: chrF {s['chrf']} < {args.min_chrf}")
    all_chrf = [s["chrf"] for s in summary_dirs.values() if s["delivered"]]
    return {"passed": not problems, "problems": problems, "speech_to_text": summary_stt, "translation": summary_dirs,
            "mean_chrf": round(float(np.mean(all_chrf)), 1) if all_chrf else None}


def write_report(out: Path, meta: dict, summary: dict, results: list[dict]) -> None:
    lines = [f"# Translation bot test: {meta['date']}", "",
             f"{len(results)} sentences spoken by bots in {', '.join(meta['languages'])}"
             f"{' (speakers on Auto-detect)' if meta['auto_detect'] else ''}, read by one listener bot per language, "
             f"through the real LiveKit server and AI worker. Scored against the FLEURS human references.", "",
             f"**Result: {'PASS' if summary['passed'] else 'FAIL'}**" + ("" if summary["passed"] else ": " + "; ".join(summary["problems"])), "",
             "## Speech-to-text (what the worker heard)", "",
             "| Spoken language | Sentences | Transcribed | WER (lower is better) |" + (" Language detected |" if meta["auto_detect"] else ""),
             "|---|---|---|---|" + ("---|" if meta["auto_detect"] else "")]
    for language, s in summary["speech_to_text"].items():
        lines.append(f"| {language} | {s['sentences']} | {s['delivered']} | {pct(s['wer'])} |"
                     + (f" {s['language_detected_ok']}/{s['sentences']} |" if meta["auto_detect"] else ""))
    lines += ["", "## Translation (what each listener read)", "",
              f"Mean chrF over all directions: **{summary['mean_chrf']}** (text-only reference on these sentences: 54).", "",
              "| Direction | Sentences | Delivered | chrF | BLEU | Wrong language | Untranslated | Delay p50 / max |", "|---|---|---|---|---|---|---|---|"]
    for name, s in summary["translation"].items():
        lines.append(f"| {name} | {s['sentences']} | {s['delivered']} | {s['chrf']} | {s['bleu']} | {s['wrong_language']} | {s['untranslated']} | "
                     f"{s['latency_p50_s']} s / {s['latency_max_s']} s |")
    lines += ["", "## Every sentence", ""]
    for r in results:
        lines.append(f"### {r['language']} · FLEURS {r['sentence_id']}")
        lines.append(f"- **Said:** {r['reference']}")
        lines.append(f"- **Heard:** {r['heard'] if r['heard'] is not None else '(nothing)'}" + (f" — WER {r['wer']:.0%}" if r["heard"] is not None else ""))
        for tgt, o in r["translations"].items():
            got = o["text"] if o["text"] is not None else "(nothing arrived)"
            lines.append(f"- **{tgt}:** {got}" + (f" — chrF {o['chrf']:.0f}, {o['latency_s']:.1f} s" if o["text"] is not None else ""))
            lines.append(f"  - reference: {o['reference']}")
        lines.append("")
    (out / "report.md").write_text("\n".join(lines), encoding="utf-8")


async def main_async(args) -> int:
    for key in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
        if not os.environ.get(key):
            print(f"{key} is not set (make test_bot reads it from .env)", file=sys.stderr)
            return 2
    languages = args.languages
    loaded = load_sentences(languages, args.clips + 1)
    warmup = next(x for x in reversed(loaded) if x.language == languages[0])  # one spare sentence, not scored
    sentences = [x for x in loaded if x is not warmup]
    for language in languages:  # keep --clips per language (the others loaded one spare too)
        mine = [x for x in sentences if x.language == language]
        for extra in mine[args.clips:]:
            sentences.remove(extra)
    args.out.mkdir(parents=True, exist_ok=True)
    room_name = f"translation-bot-{uuid.uuid4().hex[:6]}"
    try:
        await dispatch(room_name)
    except Exception as error:
        print(f"cannot reach LiveKit at {os.environ['LIVEKIT_URL']} ({type(error).__name__}).\n"
              "Start the stack first in another terminal: make dev (wait until the AI worker has loaded its models).",
              file=sys.stderr)
        return 2
    started = time.monotonic()

    listeners = []
    for language in languages:
        room = await join(room_name, f"loadbot_reader_{language}", language, language, captions=True)
        listener = Listener(language, room)
        listen(listener, started)
        listeners.append(listener)
    speakers: dict[str, Speaker] = {}
    for language in languages:
        room = await join(room_name, f"loadbot_speaker_{language}", language, "auto" if args.auto_detect else language, captions=False)
        source = rtc.AudioSource(SAMPLE_RATE, 1)
        track = rtc.LocalAudioTrack.create_audio_track("mic", source)
        publication = await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        speakers[language] = Speaker(room, source, publication.sid)
    print(f"room {room_name}: {len(sentences)} sentences, {', '.join(languages)}"
          f"{', speakers on auto-detect' if args.auto_detect else ''} -> {args.out}", flush=True)

    # The worker may still be loading models: wait for a first caption before scoring anything.
    # The warm-up sentence is not scored, but it stays in the alignment so its late captions are
    # not credited to the first real sentence.
    played: list[tuple[Sentence | None, str, float, float]] = []  # sentence (None: warm-up), language, start, end
    deadline = time.monotonic() + args.warmup_s
    ready = False
    while time.monotonic() < deadline and not ready:
        t0 = time.monotonic() - started
        ended, got = await speak_and_collect(speakers[warmup.language], warmup.audio, listeners, started, 1.0, 30)
        played.append((None, warmup.reference, t0, ended))
        ready = any(got.values())
    if not ready:
        print(f"no caption within {args.warmup_s:.0f} s: is the AI worker running (make dev)?", file=sys.stderr)
        for room in [l.room for l in listeners] + [s.room for s in speakers.values()]:
            await room.disconnect()
        return 2

    for i, sentence in enumerate(sentences, 1):
        speaker = speakers[sentence.language]
        t0 = time.monotonic() - started
        ended, got = await speak_and_collect(speaker, sentence.audio, listeners, started, args.settle_s, args.timeout_s)
        played.append((sentence, sentence.reference, t0, ended))
        print(f"{i:>3}/{len(sentences)} {sentence.language} spoken, captions from {sum(1 for g in got.values() if g)}/{len(listeners)} listeners",
              flush=True)
        await speaker.quiet(args.gap_s)
    # Stragglers: a slow worker can still be finishing the last sentences. Wait until no caption
    # has come for 10 s (at most --timeout-s).
    deadline = time.monotonic() + args.timeout_s
    while time.monotonic() < deadline:
        await asyncio.gather(*(s.quiet(1.0) for s in speakers.values()))
        last = max((c.t for l in listeners for c in l.finals), default=0.0)
        if time.monotonic() - started - last >= 10:
            break
    for room in [l.room for l in listeners] + [s.room for s in speakers.values()]:
        await room.disconnect()

    owner = {s.track_sid: language for language, s in speakers.items()}
    with (args.out / "captions.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["t_s", "listener", "speaker", "topic", "language", "text"])
        for l in listeners:
            for c in sorted(l.finals, key=lambda c: c.t):
                w.writerow([f"{c.t:.2f}", l.language, owner.get(c.track, "?"), c.topic, c.language, c.text])
    with (args.out / "spoken.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["start_s", "end_s", "language", "sentence_id", "text"])
        for sentence, ref, t0, t1 in played:
            w.writerow([f"{t0:.2f}", f"{t1:.2f}", sentence.language if sentence else warmup.language,
                        sentence.sentence_id if sentence else "warm-up", ref])
    return finish(args, played, warmup, listeners, speakers, room_name, languages)


def finish(args, played, warmup: Sentence, listeners: list[Listener], speakers: dict, room_name: str, languages: list[str]) -> int:
    results = build_results(played, warmup, listeners, speakers, args)
    summary = score([], results, languages, args)
    meta = {"date": time.strftime("%Y-%m-%d %H:%M"), "room": room_name, "languages": languages, "auto_detect": args.auto_detect,
            "limits": {"max_wer": args.max_wer, "min_chrf": args.min_chrf}}
    (args.out / "results.json").write_text(json.dumps({**meta, "summary": summary, "sentences": results}, ensure_ascii=False, indent=2),
                                           encoding="utf-8")
    with (args.out / "clips.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["sentence_id", "spoken", "target", "reference", "output", "wer_or_chrf", "latency_s"])
        for r in results:
            w.writerow([r["sentence_id"], r["language"], r["language"], r["reference"], r["heard"] or "", r["wer"], r["transcript_latency_s"]])
            for tgt, o in r["translations"].items():
                w.writerow([r["sentence_id"], r["language"], tgt, o["reference"], o["text"] or "", o["chrf"], o["latency_s"]])
    write_report(args.out, meta, summary, results)

    print()
    for language, s in summary["speech_to_text"].items():
        print(f"speech-to-text {language}: {s['delivered']}/{s['sentences']} transcribed, WER {pct(s['wer'])}")
    for name, s in summary["translation"].items():
        print(f"translation {name}: {s['delivered']}/{s['sentences']} delivered, chrF {s['chrf']}, BLEU {s['bleu']}, "
              f"delay p50 {s['latency_p50_s']} s")
    print(f"\n{'PASS' if summary['passed'] else 'FAIL'}" + ("" if summary["passed"] else ": " + "; ".join(summary["problems"])))
    print(f"report: {args.out / 'report.md'}")
    return 0 if summary["passed"] else 1


def rescore(args) -> int:
    """Scores a finished run again from its captions.csv and spoken.csv (no LiveKit needed)."""
    from types import SimpleNamespace
    run_dir = args.rescore
    old = json.loads((run_dir / "results.json").read_text(encoding="utf-8")) if (run_dir / "results.json").exists() else {}
    args.auto_detect = old.get("auto_detect", args.auto_detect)
    parallel = [json.loads(line) for line in PARALLEL.read_text(encoding="utf-8").splitlines() if line.strip()]
    with (run_dir / "spoken.csv").open(encoding="utf-8") as f:
        spoken = list(csv.DictReader(f))
    languages = list(dict.fromkeys(row["language"] for row in spoken))
    with (run_dir / "captions.csv").open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    languages += [l for l in dict.fromkeys(r["listener"] for r in rows) if l not in languages]

    def sentence_for(row) -> Sentence:
        match = next((p for p in parallel if p.get(row["language"]) == row["text"]), {})
        return Sentence(match.get("id", row["sentence_id"]), row["language"], np.zeros(0, dtype=np.int16), row["text"],
                        {l: match.get(l, "") for l in languages})

    played, warmup = [], None
    for row in spoken:
        sentence = sentence_for(row)
        if row["sentence_id"] == "warm-up":
            warmup = sentence
            played.append((None, row["text"], float(row["start_s"]), float(row["end_s"])))
        else:
            played.append((sentence, row["text"], float(row["start_s"]), float(row["end_s"])))
    if warmup is None:  # a run without warm-up rows: any sentence works, it is never scored
        warmup = next(p[0] for p in played if p[0])
    listeners = []
    for language in languages:
        listener = Listener(language, None)
        listener.finals = [Caption(float(r["t_s"]), r["topic"], r["language"], r["speaker"], r["text"])
                           for r in rows if r["listener"] == language and r["speaker"] != "?"]
        listeners.append(listener)
    speakers = {language: SimpleNamespace(track_sid=language) for language in languages}
    args.out = run_dir
    return finish(args, played, warmup, listeners, speakers, old.get("room", run_dir.name), languages)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--languages", nargs="+", default=["fr-FR", "en-US", "ar-SA"])
    parser.add_argument("--clips", type=int, default=5, help="sentences spoken per language")
    parser.add_argument("--auto-detect", action="store_true", help="speakers on 'I speak: Auto': tests language detection too")
    parser.add_argument("--max-wer", type=float, default=0.5, help="fail above this mean word error rate per language")
    parser.add_argument("--min-chrf", type=float, default=35, help="fail below this chrF per direction")
    parser.add_argument("--settle-s", type=float, default=3.0, help="quiet time after the last caption before the next sentence")
    parser.add_argument("--timeout-s", type=float, default=40, help="give up waiting for a sentence's captions after this")
    parser.add_argument("--gap-s", type=float, default=1.0, help="extra silence between sentences")
    parser.add_argument("--warmup-s", type=float, default=300, help="how long to wait for the worker's first caption")
    parser.add_argument("--out", type=Path, default=Path("data/translation-bot") / time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--rescore", type=Path, metavar="RUN_DIR", help="score a finished run again from its saved captions")
    args = parser.parse_args()
    if args.rescore:
        return rescore(args)
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
