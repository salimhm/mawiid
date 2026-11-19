"""Live-fire load test: bot participants talk in real LiveKit rooms and time every caption.

Each bot joins with captions on, reads one language and speaks another (FLEURS clips from
fetch_samples.py, looped at real-time pace with silence between clips, so the VAD sees each
phrase end). The real mawiid-translator worker is dispatched to every room, exactly as the
backend does it, so the whole path is measured: LiveKit -> worker -> Whisper -> MADLAD ->
LiveKit -> every listener.

Latency = time a listener receives a final caption - time the speaker finished the clip it
belongs to (clips are trimmed of leading and trailing silence, so this is the end of speech;
otherwise a fast caption lands before the clip's tail and the clip looks dropped) (includes the 500 ms VAD pause and the 1.5 s hold of mid-sentence finals). The
worker sends a speaker's finals in order, so for each (listener, speaker) pair the first final
after a clip ends is matched to the oldest clip that has no caption yet; when the worker falls
behind, the measured latency grows with its backlog instead of hiding it. A clip that gets no
caption within --drop-after-s is counted as dropped.

Bots are named loadbot_*: the worker finds no account behind them, so nothing is saved in any
tenant vault. Run it from a machine near the server, with the LiveKit key of the deployment:

    LIVEKIT_URL=wss://rtc.example.com LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \\
    python scripts/room_loadtest.py --rooms 1 --speakers 5 --minutes 60 --out data/loadtest/5x1

    --concurrency 1     one person talks at a time (a meeting)
    --concurrency 0     everyone talks at once (default: the worst case, to find the limit)
    --rooms 3           three rooms at once, as three tenants sharing one worker
    --ramp 1,2,4,6,8,10 --step-minutes 10
                        one 60 min run that raises the people talking at once per room every
                        10 min: the summary names the last step within the limits and the first
                        one past them (the breaking point), instead of one pass/fail per run

Limits (the runbook's): p95 above --sla-p95-s (3 s), more than --sla-drop (2 %) of clips
without caption, or p50 rising --rise-minutes (5) minutes in a row (a growing backlog).

With MAWIID_STAGE_TIMINGS=1 on the worker, every final caption also says how long its phrase
spent in Whisper, waiting behind the speaker's earlier translations, and in MADLAD, so the
summary shows which stage the lag comes from.

Writes <out>/captions.csv (one row per caption received), <out>/clips.csv (one row per clip
spoken) and <out>/summary.json, and prints a summary per minute while it runs.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import random
import sys
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from livekit import api, rtc

sys.path.insert(0, str(Path(__file__).resolve().parent))
from benchmark import SAMPLES_DIR, load_audio  # noqa: E402

SAMPLE_RATE = 16000
FRAME = SAMPLE_RATE // 50  # 20 ms
TOPICS = ("lk.transcription", "mawiid.translation.v1")
STAGES = {"stt": "mawiid.timing.stt_ms", "queue": "mawiid.timing.queue_ms", "mt": "mawiid.timing.mt_ms"}


@dataclass
class Clip:
    clip_id: int
    room: str
    speaker: str
    language: str
    started: float
    step: int = 0
    ended: float = 0.0
    duration_s: float = 0.0


@dataclass
class Stats:
    latencies: list[float] = field(default_factory=list)
    stages: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))  # stage -> seconds
    clips: int = 0
    captioned: int = 0
    dropped: int = 0


class TalkGate:
    """How many bots of one room may talk at once (0: all). The ramp raises the limit live."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.active = 0

    def try_acquire(self) -> bool:
        if self.limit > 0 and self.active >= self.limit:
            return False
        self.active += 1
        return True

    def release(self) -> None:
        self.active -= 1


class Recorder:
    def __init__(self, out: Path, drop_after_s: float) -> None:
        out.mkdir(parents=True, exist_ok=True)
        self.out = out
        self.drop_after_s = drop_after_s
        self.started = time.monotonic()
        self._captions = (out / "captions.csv").open("w", newline="", encoding="utf-8")
        self._clips = (out / "clips.csv").open("w", newline="", encoding="utf-8")
        self.captions = csv.writer(self._captions)
        self.clips = csv.writer(self._clips)
        self.captions.writerow(["t_s", "room", "listener", "speaker", "topic", "language", "segment_id", "clip_id", "step", "latency_s",
                                "chars", *(f"{stage}_s" for stage in STAGES)])
        self.clips.writerow(["clip_id", "room", "speaker", "language", "step", "start_s", "end_s", "duration_s"])
        # (room, listener, speaker track) -> clips spoken that this listener has no caption for yet
        self.waiting: dict[tuple[str, str, str], deque[Clip]] = defaultdict(deque)
        self.track_owner: dict[tuple[str, str], str] = {}  # (room, track sid) -> speaker identity
        self.listeners: dict[str, set[str]] = defaultdict(set)  # room -> identities with captions on
        self.minute: dict[int, Stats] = defaultdict(Stats)
        self.steps: dict[int, Stats] = defaultdict(Stats)  # by the step the clip was spoken in
        self.total = Stats()
        self.step = 0
        self._next_clip = 0

    def now(self) -> float:
        return time.monotonic() - self.started

    def new_clip(self, room: str, speaker: str, language: str) -> Clip:
        self._next_clip += 1
        return Clip(self._next_clip, room, speaker, language, self.now(), self.step)

    def clip_done(self, clip: Clip, track_sid: str) -> None:
        self.clips.writerow([clip.clip_id, clip.room, clip.speaker, clip.language, clip.step, f"{clip.started:.3f}",
                             f"{clip.ended:.3f}", f"{clip.duration_s:.2f}"])
        for stats in (self.minute[int(clip.ended // 60)], self.steps[clip.step], self.total):
            stats.clips += 1
        for listener in self.listeners[clip.room]:
            if listener != clip.speaker:
                self.waiting[(clip.room, listener, track_sid)].append(clip)

    def caption(self, room: str, listener: str, topic: str, attributes: dict[str, str], text: str) -> None:
        if attributes.get("lk.transcription_final") != "true":
            return
        t = self.now()
        track = attributes.get("lk.transcribed_track_id", "")
        speaker = self.track_owner.get((room, track), "?")
        queue = self.waiting.get((room, listener, track))
        clip = queue.popleft() if queue else None
        latency = t - clip.ended if clip else None
        stages = {}
        for stage, key in STAGES.items():
            try:
                stages[stage] = int(attributes[key]) / 1000
            except (KeyError, ValueError):
                pass
        self.captions.writerow([f"{t:.3f}", room, listener, speaker, topic, attributes.get("mawiid.language", ""),
                                attributes.get("lk.segment_id", ""), clip.clip_id if clip else "", clip.step if clip else "",
                                f"{latency:.3f}" if latency is not None else "", len(text),
                                *(f"{stages[stage]:.3f}" if stage in stages else "" for stage in STAGES)])
        if latency is not None:
            for stats in (self.minute[int(t // 60)], self.steps[clip.step], self.total):
                stats.latencies.append(latency)
                stats.captioned += 1
                for stage, seconds in stages.items():
                    stats.stages[stage].append(seconds)

    def expire(self) -> None:
        """Clips nobody got a caption for in time are dropped (Whisper found no speech, or overload)."""
        limit = self.now() - self.drop_after_s
        for queue in self.waiting.values():
            while queue and queue[0].ended < limit:
                clip = queue.popleft()
                for stats in (self.minute[int(clip.ended // 60)], self.steps[clip.step], self.total):
                    stats.dropped += 1

    def flush(self) -> None:
        self._captions.flush()
        self._clips.flush()

    def close(self, meta: dict, limits: "Limits", schedule: list[int], step_minutes: float) -> dict:
        self.expire()
        self._captions.close()
        self._clips.close()
        per_minute = {m: describe(s) for m, s in sorted(self.minute.items())}
        steps = []
        for i, talkers in enumerate(schedule):
            d = describe(self.steps[i])
            first, last = int(i * step_minutes), int((i + 1) * step_minutes)
            p50s = [per_minute[m]["p50_s"] for m in range(first, last) if m in per_minute]
            steps.append({"step": i, "talkers_per_room": talkers or "all", "minutes": [first, last], **d,
                          "breaks": limits.check(d, p50s)})
        broken = next((s for s in steps if s["breaks"]), None)
        last_good = None
        for s in steps:
            if s["breaks"]:
                break
            last_good = s
        summary = {**meta, "limits": vars(limits),
                   "verdict": {
                       "within_limits": broken is None,
                       "last_good_talkers_per_room": last_good["talkers_per_room"] if last_good else None,
                       "breaking_point_talkers_per_room": broken["talkers_per_room"] if broken else None,
                       "why": broken["breaks"] if broken else [],
                   },
                   "steps": steps, "overall": describe(self.total), "per_minute": per_minute}
        (self.out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        return summary


@dataclass
class Limits:
    p95_s: float
    drop_rate: float
    rise_minutes: int

    def check(self, d: dict, minute_p50s: list[float]) -> list[str]:
        """Why these numbers break the limits (empty: within them)."""
        reasons = []
        if d["p95_s"] == d["p95_s"] and d["p95_s"] > self.p95_s:  # not NaN
            reasons.append(f"p95 {d['p95_s']:.2f}s > {self.p95_s}s")
        if d["drop_rate"] is not None and d["drop_rate"] > self.drop_rate:
            reasons.append(f"drop rate {d['drop_rate']:.1%} > {self.drop_rate:.0%}")
        if d["captions_matched"] == 0 and d["clips_spoken"]:
            reasons.append("no caption at all")
        run = 0
        for previous, current in zip(minute_p50s, minute_p50s[1:]):
            run = run + 1 if current > previous else 0
            if run >= self.rise_minutes:
                reasons.append(f"p50 rose {self.rise_minutes} minutes in a row (backlog)")
                break
        return reasons


def describe(stats: Stats) -> dict:
    lat = np.array(stats.latencies) if stats.latencies else np.array([np.nan])
    expected = stats.captioned + stats.dropped
    stages = {}
    for stage in STAGES:
        values = stats.stages.get(stage)
        if values:
            stages[stage] = {"p50_s": round(float(np.percentile(values, 50)), 3),
                             "p95_s": round(float(np.percentile(values, 95)), 3),
                             "max_s": round(float(np.max(values)), 3)}
    return {
        "clips_spoken": stats.clips,
        "captions_matched": stats.captioned,
        "dropped": stats.dropped,
        "drop_rate": round(stats.dropped / expected, 4) if expected else None,
        "p50_s": round(float(np.nanpercentile(lat, 50)), 3),
        "p95_s": round(float(np.nanpercentile(lat, 95)), 3),
        "p99_s": round(float(np.nanpercentile(lat, 99)), 3),
        "max_s": round(float(np.nanmax(lat)), 3),
        **({"stages": stages} if stages else {}),
    }


def trim_silence(audio: np.ndarray, pad_s: float = 0.1) -> np.ndarray:
    """Cut leading and trailing silence (20 ms frames under 5 % of the loudest one's RMS)."""
    frames = len(audio) // FRAME
    if frames == 0:
        return audio
    rms = np.sqrt(np.mean(audio[: frames * FRAME].reshape(frames, FRAME) ** 2, axis=1))
    loud = np.flatnonzero(rms > 0.05 * rms.max())
    if loud.size == 0:
        return audio
    pad = int(pad_s * 50)
    return audio[max(0, loud[0] - pad) * FRAME : min(frames, loud[-1] + 1 + pad) * FRAME]


def load_clips(language: str, limit: int) -> list[np.ndarray]:
    lang_dir = SAMPLES_DIR / language
    entries = [json.loads(line) for line in (lang_dir / "manifest.jsonl").read_text(encoding="utf-8").splitlines()]
    clips = []
    for entry in entries[:limit]:
        audio = trim_silence(load_audio(lang_dir / entry["audio"]))
        clips.append((np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16))
    if not clips:
        raise SystemExit(f"no clips for {language} in {lang_dir}; run scripts/fetch_samples.py")
    return clips


def token(identity: str, room: str, attributes: dict[str, str]) -> str:
    return (
        api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        .with_identity(identity)
        .with_name(identity)
        .with_attributes(attributes)
        .with_ttl(__import__("datetime").timedelta(hours=12))
        .with_grants(api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True,
                                     can_publish_data=True, can_update_own_metadata=False))
        .to_jwt()
    )


async def run_bot(args, rec: Recorder, room_name: str, index: int, spoken: str, reads: str,
                  clips: list[np.ndarray], talk: TalkGate, deadline: float) -> None:
    identity = f"loadbot_{index}"
    room = rtc.Room()

    def handler(topic: str):
        def on_stream(reader: rtc.TextStreamReader, sender: str) -> None:
            async def read() -> None:
                try:
                    text = await reader.read_all()
                except Exception:
                    return
                rec.caption(room_name, identity, topic, dict(reader.info.attributes or {}), text)
            asyncio.ensure_future(read())
        return on_stream

    for topic in TOPICS:
        room.register_text_stream_handler(topic, handler(topic))
    attributes = {
        "mawiid.language": reads,
        "mawiid.spoken_language": "auto" if args.auto_detect else spoken,
        "mawiid.translation_enabled": "true",
    }
    await room.connect(os.environ["LIVEKIT_URL"], token(identity, room_name, attributes))
    rec.listeners[room_name].add(identity)
    source = rtc.AudioSource(SAMPLE_RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("mic", source)
    publication = await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
    rec.track_owner[(room_name, publication.sid)] = identity

    silence = np.zeros(FRAME, dtype=np.int16)
    clock = time.monotonic()  # when the next 20 ms frame is due, so the bot never drifts from real time

    async def send(frame: np.ndarray) -> None:
        nonlocal clock
        if len(frame) < FRAME:
            frame = np.concatenate([frame, silence[: FRAME - len(frame)]])
        clock += FRAME / SAMPLE_RATE
        wait = clock - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        await source.capture_frame(rtc.AudioFrame(frame.tobytes(), SAMPLE_RATE, 1, FRAME))

    async def pause(seconds: float) -> None:
        for _ in range(int(seconds * 50)):
            await send(silence)

    await pause(1.0 + index * 0.37)  # staggered start
    order = list(range(len(clips)))
    rng = random.Random(index)
    try:
        while time.monotonic() < deadline:
            rng.shuffle(order)
            for i in order:
                if time.monotonic() >= deadline:
                    break
                # Keep the track flowing while waiting for a turn: LiveKit sends nothing during
                # a real pause either, but the VAD needs silence to end the last phrase.
                while not talk.try_acquire():
                    await send(silence)
                try:
                    audio = clips[i]
                    clip = rec.new_clip(room_name, identity, spoken)
                    for start in range(0, len(audio), FRAME):
                        await send(audio[start : start + FRAME])
                    clip.ended = rec.now()
                    clip.duration_s = len(audio) / SAMPLE_RATE
                    rec.clip_done(clip, publication.sid)
                    await pause(args.gap_s)
                finally:
                    talk.release()
                await pause(rng.uniform(0, args.jitter_s))
        await pause(args.drop_after_s)  # let the last captions arrive
    finally:
        await room.disconnect()


async def dispatch(room_name: str) -> None:
    async with api.LiveKitAPI(os.environ["LIVEKIT_URL"].replace("wss://", "https://").replace("ws://", "http://"),
                              os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"]) as lk:
        await lk.room.create_room(api.CreateRoomRequest(name=room_name, empty_timeout=120))
        await lk.agent_dispatch.create_dispatch(api.CreateAgentDispatchRequest(
            agent_name=os.environ.get("LIVEKIT_TRANSLATOR_AGENT") or "mawiid-translator", room=room_name))


async def report(rec: Recorder, deadline: float, gates: list[TalkGate], schedule: list[int], step_s: float,
                 limits: Limits) -> None:
    printed = -1
    talkers_at: dict[int, int] = {}
    print(f"{'min':>4} {'talk':>4} {'clips':>6} {'capt':>6} {'drop':>5} {'p50':>6} {'p95':>6} {'max':>6} "
          f"{'stt95':>6} {'que95':>6} {'mt95':>6}")
    while True:
        step = min(int(rec.now() // step_s), len(schedule) - 1)
        if step != rec.step or not talkers_at:
            rec.step = step
            for gate in gates:
                gate.limit = schedule[step]
            if len(schedule) > 1:
                print(f"---- step {step}: {schedule[step] or 'all'} talking at once per room", flush=True)
        talkers_at[int(rec.now() // 60)] = schedule[step]
        await asyncio.sleep(5)
        rec.expire()
        rec.flush()
        minute = int(rec.now() // 60) - 1
        if minute > printed and minute >= 0:
            for m in range(printed + 1, minute + 1):
                d = describe(rec.minute[m])
                st = d.get("stages", {})
                cols = " ".join(f"{st[s]['p95_s']:>5.2f}s" if s in st else f"{'-':>6}" for s in STAGES)
                flag = " !" if limits.check(d, []) else ""
                print(f"{m:>4} {talkers_at.get(m, 0) or 'all':>4} {d['clips_spoken']:>6} {d['captions_matched']:>6} "
                      f"{d['dropped']:>5} {d['p50_s']:>5.2f}s {d['p95_s']:>5.2f}s {d['max_s']:>5.2f}s {cols}{flag}",
                      flush=True)
            printed = minute
        if time.monotonic() > deadline:
            return


async def main_async(args) -> int:
    for key in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
        if not os.environ.get(key):
            raise SystemExit(f"{key} is not set")
    languages = args.languages
    if args.ramp:
        schedule = [int(n) for n in args.ramp.split(",")]
        if max(schedule) > args.speakers:
            raise SystemExit(f"--ramp goes up to {max(schedule)} talkers but rooms have {args.speakers} speakers")
        args.minutes = len(schedule) * args.step_minutes
        step_s = args.step_minutes * 60
    else:
        schedule = [args.concurrency]
        step_s = args.minutes * 60 + 1
    limits = Limits(args.sla_p95_s, args.sla_drop, args.rise_minutes)
    clips = {language: load_clips(language, args.clips) for language in languages}
    rec = Recorder(args.out, args.drop_after_s)
    deadline = time.monotonic() + args.minutes * 60
    run_id = uuid.uuid4().hex[:6]
    bots = []
    gates = []
    for r in range(args.rooms):
        room_name = f"loadtest-{run_id}-{r}"
        await dispatch(room_name)
        talk = TalkGate(schedule[0])
        gates.append(talk)
        for s in range(args.speakers):
            spoken = languages[s % len(languages)]
            reads = languages[(s + 1) % len(languages)]  # everyone reads another language: maximum translation
            bots.append(run_bot(args, rec, room_name, r * 100 + s, spoken, reads, clips[spoken], talk, deadline))
    talking = f"ramp {args.ramp} every {args.step_minutes} min" if args.ramp else f"concurrency {args.concurrency or 'all'}"
    print(f"run {run_id}: {args.rooms} room(s) x {args.speakers} speakers, {args.minutes} min, "
          f"{talking}, languages {', '.join(languages)} -> {args.out}", flush=True)
    reporter = asyncio.create_task(report(rec, deadline + args.drop_after_s, gates, schedule, step_s, limits))
    results = await asyncio.gather(*bots, return_exceptions=True)
    for result in results:
        if isinstance(result, Exception):
            print(f"bot failed: {result!r}", file=sys.stderr)
    await reporter
    summary = rec.close({"run": run_id, "rooms": args.rooms, "speakers_per_room": args.speakers,
                         "minutes": args.minutes, "concurrency": args.concurrency, "ramp": schedule if args.ramp else None,
                         "languages": languages}, limits, schedule, step_s / 60)
    for s in summary["steps"]:
        print(f"step {s['step']}: {s['talkers_per_room']} talking/room  p50 {s['p50_s']}s  p95 {s['p95_s']}s  "
              f"drop {s['drop_rate']}  {'BREAKS: ' + '; '.join(s['breaks']) if s['breaks'] else 'ok'}")
    print(json.dumps({"verdict": summary["verdict"], "overall": summary["overall"]}, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rooms", type=int, default=1)
    parser.add_argument("--speakers", type=int, default=5, help="bots per room")
    parser.add_argument("--minutes", type=float, default=10)
    parser.add_argument("--concurrency", type=int, default=0, help="bots talking at once per room (0: all)")
    parser.add_argument("--languages", nargs="+", default=["fr-FR", "en-US", "ar-SA"])
    parser.add_argument("--auto-detect", action="store_true", help="speakers on 'I speak: Auto' (one more Whisper pass per phrase)")
    parser.add_argument("--clips", type=int, default=20, help="clips per language to loop over")
    parser.add_argument("--gap-s", type=float, default=2.0, help="silence after each clip (> the 1.5 s hold)")
    parser.add_argument("--jitter-s", type=float, default=1.0, help="extra random silence between clips")
    parser.add_argument("--ramp", help="talkers per room for each step, e.g. 1,2,4,6,8,10 (sets --minutes)")
    parser.add_argument("--step-minutes", type=float, default=10, help="length of each --ramp step")
    parser.add_argument("--sla-p95-s", type=float, default=3.0)
    parser.add_argument("--sla-drop", type=float, default=0.02)
    parser.add_argument("--rise-minutes", type=int, default=5)
    parser.add_argument("--drop-after-s", type=float, default=20.0, help="a clip without caption after this is dropped")
    parser.add_argument("--out", type=Path, default=Path("data/loadtest") / time.strftime("%Y%m%d-%H%M%S"))
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
