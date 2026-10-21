# Presence: What Was Implemented

_2026-10-21 · Spec: [readme.md](readme.md)_

The presence module is done: tickets, the WebSocket gateway, online status, appear offline, busy during a live, multi-device, multi-instance fan-out, and an offline sweeper. It follows the `.agents` rules and passes 12 unit tests plus an end-to-end check against the real Upstash Redis and Turso.

## Files

| File                     | What it contains                                                 |
| ------------------------ | ---------------------------------------------------------------- |
| `presence.controller.ts` | `controller_presence`: the WebSocket route and the 3 HTTP routes |
| `presence.dto.ts`        | `dto_presence` and `dto_schema_presence`                         |
| `presence.service.ts`    | `service_presence`: all logic and every Redis call               |
| `presence.test.ts`       | 12 tests with an in-memory Redis and database                    |
| `src/lib/*.lib.ts`       | Shared libs this module needed (listed below)                    |
| `src/app.ts`             | Registers the module and starts and stops the background work    |

Your starter controller (`presence.get('/')` returning hello world) was replaced; it did not follow the controller pattern and failed the typecheck.

## Endpoints

| Method | Path                            | Function                   | Auth              | Result                                                          |
| ------ | ------------------------------- | -------------------------- | ----------------- | --------------------------------------------------------------- |
| POST   | `/presence/ticket`              | `ticket`                   | `x-user-id` (dev) | `{ data: { ticket, expires_in: 30 } }`                          |
| WS     | `/presence/ws?ticket=`          | `open`, `message`, `close` | Ticket            | Events                                                          |
| GET    | `/presence?user_id=1&user_id=2` | `find`                     | `x-user-id` (dev) | `{ data: [{ user_id, presence_status, presence_updated_at }] }` |
| PATCH  | `/presence`                     | `update`                   | `x-user-id` (dev) | `{ data: { user_id, presence_status, presence_updated_at } }`   |

Messages the app sends on the socket:

```json
{ "type": "presence.ping" }
{ "type": "presence.status", "data": { "presence_status": "away" } }
```

Any other message is rejected by the DTO with a validation error on the socket.

## How a connection works

1. The app calls `POST /presence/ticket`. The service creates a random 32-byte ticket and stores `ws_ticket:<ticket> = user_id` for 30 seconds. Limit: 10 tickets per minute per user.
2. The app opens `/presence/ws?ticket=...`. During the upgrade, a `resolve` hook calls `service_presence.connect`: `GETDEL` makes the ticket single-use, and a bad or reused ticket rejects the upgrade before the socket opens. The same step loads the user's memberships and builds the topic list.
3. `open` subscribes the socket to `user:<id>`, `department:<id>` and `organization:<id>` topics, writes the heartbeat (45 s), counts the socket, and broadcasts `presence.updated`.
4. Every `presence.ping` refreshes the heartbeat. If the heartbeat had already expired (for example, after a long sleep), it is written again and the user is announced online.
5. `close` lowers the socket count. Only the last socket of that user publishes `offline` at once; with a phone and a laptop open, closing one keeps the user online.

The socket route is registered before `lib_jwt`, because a WebSocket authenticates with the ticket, not a header.

## How status is computed

The status other people see is computed at read time, never stored as one value:

| Condition                    | Shown as                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| No heartbeat                 | `offline`                                                      |
| The user chose `offline`     | `offline`, even when connected or in a live                    |
| In a live (`user:<id>:live`) | `busy`                                                         |
| Otherwise                    | The user's choice (`online`, `away`, `busy`), default `online` |

- A choice other than `online` is kept in `presence:choice:<id>` without a TTL, so "appear offline" survives reconnects.
- `presence_updated_at` is hidden (`null`) whenever the user shows as offline, so it never leaks activity.
- Status changes (socket or `PATCH`) are limited to 30 per minute per user.

## Who can see whom

- `GET /presence` returns the asking user and anyone who shares an **organization** with them (through `member` → `department`). Other ids are silently dropped.
- `presence.updated` is sent to `organization:<id>` topics, so teammates in the whole organization receive it.
- Not done yet: "people they share a room with" from the spec. It needs `room_member` and `room_guest`, which the room team is building. Add those user ids in `presence_visible` and send events to those users' `user:` topics.

## Several backend instances

- Every event goes through the Redis channel `ws:event` as `{ topics, event }`.
- `service_presence.relay` opens a dedicated subscriber (`redis.duplicate()`) and forwards each event to its local sockets with Bun's `server.publish(topic, data)`.
- `service_presence.notify(topics, type, data, redis)` is the only way to send an event. It wraps data in the envelope `{ type, version: 1, data, sent_at }`.

## Offline detection when a server dies

If an instance crashes, no `close` runs. Each ping also writes the user to the sorted set `presence:seen` (score = time). Every 5 seconds, `service_presence.sweep` takes users not seen for 45 seconds:

- heartbeat still there → refresh the score;
- heartbeat gone → `ZREM`, and only the instance whose `ZREM` succeeded publishes `offline`, so no lock is needed and each user is announced once.

So a user who stops pinging shows offline within about 50 seconds.

## Redis keys

| Key                                      | TTL  | Purpose                                                        |
| ---------------------------------------- | ---- | -------------------------------------------------------------- |
| `ws_ticket:<ticket>`                     | 30 s | One-time WebSocket login                                       |
| `presence:user:<id>`                     | 45 s | Heartbeat, `{ presence_status, presence_updated_at }`          |
| `presence:choice:<id>`                   | none | Chosen status when not `online` (new, not in the spec)         |
| `presence:sockets:<id>`                  | 45 s | Open sockets of the user, for multi-device (new)               |
| `presence:seen`                          | none | Sorted set of last pings, for the sweeper (new)                |
| `user:<id>:live`                         | 6 h  | Current live; the TTL is a safety net if a leave event is lost |
| `rate:ticket:<id>`, `rate:presence:<id>` | 60 s | Rate limits                                                    |

## Hooks for other modules

```typescript
await service_presence.notify(
  [`user:${callee_id}`],
  'room.ring',
  { room_uid, caller: { user_id }, busy },
  redis,
);
await service_presence.enter_live(user_id, room_uid, database, redis);
await service_presence.leave_live(user_id, room_uid, database, redis);
```

The participant webhook handlers must call `enter_live` and `leave_live`. `leave_live` does nothing when `room_uid` is not the user's current live, so a late event from an old room cannot clear a new one.

## Shared libs added

These were placeholders. Presence needed them, and they follow the `.agents` patterns, so the room team can use them as they are.

| File                        | Export                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `src/lib/context.lib.ts`    | `lib_context` plugin with typed `database` and `redis` (`lib_database`, `lib_redis`) |
| `src/lib/jwt.lib.ts`        | `lib_jwt`, dev only: reads `x-user-id` when `ENV=dev`                                |
| `src/lib/error.lib.ts`      | `lib_error`, including the room codes from the plan                                  |
| `src/lib/middleware.lib.ts` | `lib_middleware_error`, maps `lib_error` to `{ code }` and status                    |
| `src/lib/dto.lib.ts`        | `lib_dto_payload`, `lib_dto_find_query`, `lib_dto_find_response`                     |
| `src/lib/enum.lib.ts`       | `enum_presence_status`                                                               |
| `src/lib/rate-limit.lib.ts` | `lib_rate_limit`                                                                     |

`app.ts` now takes its clients from `lib_context`, registers `lib_middleware_error` and `controller_presence`, starts `service_presence.start` after `listen`, and stops it in `onStop`.

## Choices made

- **`GET /presence` returns `{ data }`, not the paged find response.** It is a bulk lookup of up to 200 ids, not a table listing.
- **Ticket in the query string** as the spec says; it is single-use and lasts 30 seconds, so a logged URL is useless.
- **The status is never stored as one final value.** `busy` from a live and the user's own choice can change separately, and computing at read time keeps them from overwriting each other.

## How it was tested

- `bun test src/module/main/presence`: 12 tests covering single-use and expiring tickets, topics, rate limits, teammate filtering, appear offline across reconnects, busy during a live, `PATCH`, two devices, the sweeper firing exactly once, ping TTL refresh, and the event envelope.
- End to end against the dev `.env` on port 3999: `401` without the header, a working ticket, a reused ticket rejected (close code 1002), `422` on a bad query, `online` then `away` received over the socket through Redis pub/sub, a non-teammate filtered out, and `offline` after the socket closed.

## Try it

```bash
curl -X POST http://localhost:3000/presence/ticket -H "x-user-id: 1"
```

Then, in a browser console:

```javascript
const ws = new WebSocket('ws://localhost:3000/presence/ws?ticket=<ticket>');
ws.onmessage = (event) => console.log(JSON.parse(event.data));
setInterval(() => ws.send(JSON.stringify({ type: 'presence.ping' })), 20000);
```

## Still open

- Visibility for people who share a room (needs `room_member` and `room_guest`).
- Real auth: replace `lib_jwt`; nothing in this module changes.
- Push notifications when the user has no socket belong to the `device` module.
