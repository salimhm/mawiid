# Backlog 1 (16–20 Nov 2026): stress test, cost audit, security

Runbook for the week on the DGX at Microintégrèle. The servers go down Friday evening, so every
long run must be finished and its data copied off by **Friday 15:00**.

## 1. Where we expect it to break (to confirm, not assume)

All rooms share **one AI worker process** with **one copy of each model**. On GPU, Whisper and
MADLAD were built with CTranslate2's defaults (`num_workers=1`, `inter_threads=1`, GPU 0 only), so
every speaker in every room queues on one GPU while the other GPUs of the DGX sit idle. Expect
latency to grow with the number of people *talking at the same time*, not with the number of people
in the call. The deploy script also picks MADLAD **10b** on GPU hosts, which is ~3x slower than 3b.

New opt-in settings (defaults unchanged) let us test the fix the same week:

| Variable | Effect |
|---|---|
| `MAWIID_STT_WHISPER_DEVICE_INDEX=0,1,2,3` | one Whisper copy per listed GPU |
| `MAWIID_STT_WHISPER_NUM_WORKERS=2` | parallel Whisper calls per copy |
| `MAWIID_MT_DEVICE_INDEX=4,5` | one MADLAD copy per listed GPU |
| `MAWIID_MT_INTER_THREADS=2` | parallel translations per copy |

## 2. Tools

- `services/ai/scripts/room_loadtest.py`: bots join real LiveKit rooms, speak FLEURS clips at
  real-time pace with captions on, each reading another language. The real worker is dispatched.
  Times every final caption from "speaker stopped" to "listener received", counts dropped
  captions, and prints p50/p95/max per minute. Bots are `loadbot_*`, so nothing lands in a vault.
  `--ramp 1,2,3,... --step-minutes N` raises the number talking at once per room every N minutes in one
  run, and `summary.json` → `verdict` names the last step within the limits and the first one past
  them. Clips are trimmed of silence, so latency counts from the end of speech.
- `MAWIID_STAGE_TIMINGS=1` in `.env.production` (restart `ai`): final captions carry the Whisper time,
  the wait behind the speaker's earlier translations and the MADLAD time. The script prints their p95
  per minute (`stt95 que95 mt95`) and writes them to `captions.csv` and each step of `summary.json`,
  so a break is pinned to a stage. Off by default; leave it off in normal production.
- `services/ai/scripts/resource_sampler.sh <dir>`: on the DGX, GPU util/memory/power, per-container
  CPU/RAM/network, host load, every 5 s.
- Video/SFU load (not covered by the bots, which only send audio): `lk load-test` from LiveKit CLI,
  run alongside, e.g. `--video-publishers 10 --subscribers 10 --duration 1h`.

```sh
cd services/ai
.venv/bin/python scripts/fetch_samples.py --languages en-US fr-FR ar-SA   # once: clips in data/samples/
# Replace with the deployment's values (RTC_DOMAIN, LIVEKIT_API_KEY, LIVEKIT_API_SECRET in .env.production):
export LIVEKIT_URL="wss://rtc.example.com" LIVEKIT_API_KEY="CHANGE_ME" LIVEKIT_API_SECRET="CHANGE_ME"
# ON THE DGX (not the test machine), in another shell, from a checkout of this repo:
scripts/resource_sampler.sh data/loadtest/D 5
# from the test machine:
.venv/bin/python scripts/room_loadtest.py --rooms 1 --speakers 10 --ramp 1,2,3,4,5,6,7,8,9,10 --step-minutes 7 --out data/loadtest/R10
```

### Automatic report

`make dev` also starts `scripts/test_report.py` in the background. Once the servers answer it runs
the backend and AI unit tests, the smoke tests, live security probes (the production Caddyfile in a
throwaway container, a 30-request login burst, Redis counter expiries, forged/expired JWTs, malformed
input, CORS), then the load tests of `REPORT_PROFILE` with the resource sampler, and writes
`reports/<timestamp>/report.md` and `report.html` (`reports/latest` points at the newest).
`quick` (default) is ~15 min of load, `hour` runs B and C, `full` the whole matrix below, `none` skips
load. `make report` reruns it against a running stack; `REPORT=0` turns it off. Facts it cannot
measure (issue severity and ETA, the DGX hourly cost, Microintégrèle's answer) come from
`docs/test-report-input.json`.

## 3. Test matrix

"Breaks" = caption **p95 > 3.0 s**, or **drop rate > 2 %**, or p50 rising for 5 minutes in a row
(the worker is building a backlog). Baseline on a laptop RTX 4060: p50 1.24 s, p95 2.38 s.

| Run | Rooms × bots | Talking at once | Length | Purpose |
|---|---|---|---|---|
| A | 1 × 5 | 1 | 15 min | Smoke test, baseline on the DGX |
| R5 | 1 × 5 | ramp `1,2,3,4,5`, 12 min steps | 60 min | 5-user breaking point: exact number talking at once |
| R10 | 1 × 10 | ramp `1,…,10`, 7 min steps | 70 min | 10-user breaking point (7 min, so a 5-minute p50 rise can show inside a step) |
| B | 1 × 5 | all | 60+ min | 5-user endurance |
| C | 1 × 10 | 1 | 60+ min | 10-user realistic meeting |
| D | 1 × 10 | all | 60 min | 10-user worst case (expected break) |
| E | 2, 4, 6, … × 5 | 1 per room | 20 min each | Multi-tenant capacity: rooms per worker before it breaks |
| F | D and E again | | | With the GPU settings of section 1 |
| G | D | | | `MAWIID_MT_MODEL=3b` vs `10b` |

Order: A, then R5 and R10 to find the breaking point, then B/C/D as hour-long confirmations at
the last good level and one above it (`--concurrency N`). A ramp step is short, so a slow leak or
backlog only an hour shows is caught by B/C/D, not by R5/R10.

Keep each run's `summary.json`, `captions.csv`, `clips.csv` and the sampler CSVs, plus the commit and
`.env.production` model settings used (not the secrets).

## 4. Cost audit

From runs E/F: **cost per meeting-hour = DGX hourly cost ÷ rooms the worker carries at the SLA.**
The sampler gives GPU memory per extra room (marginal cost), power draw (kWh), and CPU/RAM per
container. The multi-tenant claim to prove: N tenants in one worker cost far less than N workers.
Run E gives that number directly.

## 5. Security

### Fixed this week

| Finding | Fix |
|---|---|
| Caddy forwarded all of `/api/*`: `/transcript/internal` (AI-worker only), `/webhook/livekit` and `/openapi` (the full API map) were public | `infra/compose/Caddyfile` answers 404 for them publicly; LiveKit and the worker call `backend:3000` directly |
| Login limit (10 failures / 15 min) was checked *before* the slow password hash and counted *after*: a parallel burst got every guess checked (30 of 30 in the new test) | Attempt counted first, atomically; regression test added |
| Rate-limit counters were `INCR` then `EXPIRE`: a crash between them leaves a key that never expires (permanent lockout) | TTL set first (`SET NX EX`), then `INCR` |

### Checked and holding

- Room routes look up the tenant vault by `room_uid`, then require membership (`service_room.authorize`).
- LiveKit tokens: `canUpdateOwnMetadata: false`, so a participant cannot forge `mawiid.user_id`
  or language attributes; the frontend shows captions only from the agent.
- Internal token compared in constant time; webhook signatures verified and de-duplicated.
- OTP codes are returned in the response **only with `ENV=dev`**; production template sets `ENV=production`.

### Pentest checklist (on the DGX)

1. `POST /api/auth/otp` must answer 503. If it returns a code, the server runs `ENV=dev`: anyone can sign in as any phone number. **Stop and fix first.**
2. `/api/transcript/internal`, `/api/webhook/livekit` and `/api/openapi` must answer 404 from outside.
3. Cross-tenant: user of org A against a room UID of org B on every room/message/audit/participant route. Expect 403/404, never data.
4. JWT: expired token, `alg: none`, tampered `user_id`, old `session_version` after logout or password reset.
5. Garbage input: oversized bodies, wrong types, unicode and control characters, SQL/HTML payloads in names, messages and room titles; check the stored value and how the app renders it.
6. Lobby: knock flood on a room; room locked/closed transitions.
7. LiveKit: reuse a participant token after removal (TTL 5 min); join with a token for another room.

### Known limits (not fixable this week)

- **One Turso group token opens every tenant vault.** Isolation between customers is enforced by
  the backend code, not the database. A leaked token or backend compromise exposes all tenants.
  Fix: per-database tokens.
- CORS allows any origin. Low risk while auth is a bearer header, but should be the app domain.
- The tenant DB client cache (`DB_MAX_CACHED_TENANTS`, default 100) disconnects the oldest client,
  possibly mid-query, once more than 100 tenants are active at once.
- Login lockout is per account: anyone can lock a known user out for 15 minutes with 10 bad passwords.
- `services/ai` test `test_backup_takes_over_mid_sentence_without_losing_speech` already failed
  before this week (its fake engine lacks the `detect` argument).
