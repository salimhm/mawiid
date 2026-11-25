# Mawiid: Backlog 1 Report (16–20 November 2026)

Stress testing, cost audit and security on the DGX at Microintégrèle.

All changes are on the `security_test` branch (commit `f031807`). Nothing has run on the DGX yet, so the results below come from reading the code and from local tests.

## 1. Fixed

| # | Problem | Risk | Fix | Checked |
|---|---|---|---|---|
| 1 | **Login limit bypass.** The 10-failed-attempts limit was checked before the slow password check and only counted afterwards. | An attacker sending many guesses at once got all of them tried: 30 out of 30 in the test. | Each attempt is now counted first, before the password check. | New test: exactly 10 of 30 are now tried. It fails on the old code. |
| 2 | **Internal routes were public.** The proxy forwarded everything under `/api/*`, including the AI worker's transcript-save route, the LiveKit webhook and the full API description. | Attackers could see every API route, and the save route was protected only by a token. | They now return 404 from the internet. LiveKit and the AI worker still reach the backend directly. | Caddy accepts the new config, and no client uses these routes. |
| 3 | **Permanent lockouts.** Rate-limit counters were created first and given an expiry in a separate step. | A crash between the two steps leaves a counter that never expires, so that user or key stays blocked for good. | The expiry is now set before the counter starts. | All 267 backend tests pass. |
| 4 | **Translation used one GPU.** All speakers in all rooms share one copy of each AI model, on GPU 0 only. | Captions lag once several people talk at the same time, while the DGX's other GPUs sit idle. | Four optional settings spread the models over several GPUs. Defaults are unchanged. | AI service tests pass. The real effect shows only in test runs F and G on the DGX. |

**Tools added:**

- **`services/ai/scripts/room_loadtest.py`:** times every caption and counts captions that never arrive.
- **`services/ai/scripts/resource_sampler.sh`:** records GPU, container and server usage for the cost audit.
- **`docs/backlog-1-stress-security.md`:** the runbook.

## 2. Checked and found secure

- **Rooms in another customer's space:** a user who knows a room's ID still has to be a member of that room.
- **Faking identity in a call:** a participant can't change their own user ID or language, and the app ignores captions that don't come from the translation worker.
- **Internal token and LiveKit webhooks:** the token is compared safely, and webhook messages are verified and can't be replayed.
- **Login codes in responses:** the code is returned only in dev mode, and the production settings template doesn't use dev mode.

## 3. Still to do this week (on the DGX)

1. **First thing: confirm the server isn't in dev mode.** `POST /api/auth/otp` must answer 503. If it returns a code, anyone can sign in as any phone number.
2. **Confirm the blocked routes.** `/api/transcript/internal`, `/api/webhook/livekit` and `/api/openapi` must return 404 from outside. This needs the new Caddyfile deployed first.
3. **First live run of the test script.** Run A (5 bots, 15 min) is also the first time it runs against a real server.
4. **Find the breaking point:**
   - runs B and C (5 and 10 users, 1 hour or more);
   - run D (10 users all talking at once, the expected break);
   - run E (more and more rooms at once, to measure how many customers one worker carries).
5. **Retest with the fixes:** run F (several GPUs) and run G (the 3b translation model instead of 10b).
6. **Video load:** the bots send audio only, so `lk load-test` has to run alongside them.
7. **Cost per meeting-hour:** DGX hourly cost ÷ the number of rooms carried within limits, measured in run E.
8. **Remaining pentest checks:**
   - users of one customer against another customer's rooms;
   - forged or expired login tokens, and old tokens after logout;
   - junk and oversized input;
   - flooding the waiting room;
   - reusing a call token after being removed from the call.
9. **Microintégrèle:** send the weekend-exception request. Until they answer, finish all long runs by Friday 15:00.

**Breaking point definition:** caption p95 above 3 s, more than 2% of captions lost, or latency rising for 5 minutes straight.

## 4. Known weaknesses not fixed (need decisions or more time)

| Problem | Impact | Possible fix |
|---|---|---|
| **One database token opens every customer's database** | Separation between customers depends only on the backend code. A leaked token or compromised backend exposes all customers. **This is the most serious one.** | One token per customer database (Turso supports this). |
| **Too many active customers at once** | Above 100, the backend can cut a database connection in the middle of a query, causing errors. | Close a connection only when nothing is using it, or raise the limit. |
| **Account lockout** | Anyone can block a known user for 15 minutes with 10 wrong passwords. | Also limit attempts per IP address, or add a CAPTCHA after several failures. |
| **API accepts requests from any website (CORS)** | Low risk today, because logins are sent in a header rather than a cookie. | Allow only the app's own domain. |
| **Translation model on the GPU server** | The deploy script picks the larger 10b model, which is about 3× slower. | Decide after run G. |
| **One AI service test was already failing** | No production impact. A test helper doesn't match the current code. | Fix the test helper. |
