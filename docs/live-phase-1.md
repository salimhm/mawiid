# Live Phase 1: First 10 Steps

_Last updated: 2026-10-21 · Part of [live-chat-plan.md](live-chat-plan.md) (milestones M0–M2)_

Phase 1 delivers a working live without user accounts: rooms, calls, chat, presence, ringing and moderation. Authentication and account management come later; until then a dev-only header stands in for the logged-in user.

## Who does what

| Area | Owner | Status |
| --- | --- | --- |
| Shared libs (step 1) | Omar | Done for what presence needs; see [Shared libs](#shared-libs-ready-to-use) |
| Presence and WebSocket gateway (step 9) | Omar | Done: `src/module/main/presence/` |
| Rooms, room members, participants, webhooks (steps 3–8, 10) | Peers | To do |

## Skipping auth without rework

`lib_jwt` keeps its final name and its `payload` shape (`lib_dto_payload = { user_id }`), but for now it reads the `x-user-id` header:

```bash
curl -X POST http://localhost:3000/presence/ticket -H "x-user-id: 1"
```

- It only works when `ENV=dev`; any other value returns `401 unauthorized`.
- Controllers and services never read the header themselves. They use `payload`, so when real auth arrives only `src/lib/jwt.lib.ts` changes.
- Anyone can act as any user with this header. It must never reach production.

## Shared libs ready to use

| File | Export | Use it for |
| --- | --- | --- |
| `src/lib/context.lib.ts` | `lib_context`, `lib_database`, `lib_redis` | `.use(lib_context)` in a controller gives typed `database` and `redis` in the handler context |
| `src/lib/jwt.lib.ts` | `lib_jwt` | `.use(lib_jwt)` gives `payload` (dev header for now) |
| `src/lib/error.lib.ts` | `lib_error` | `throw lib_error.room_full`; includes the room codes from the plan |
| `src/lib/middleware.lib.ts` | `lib_middleware_error` | Registered once in `app.ts`; turns `lib_error` into `{ code }` with the right status |
| `src/lib/dto.lib.ts` | `lib_dto_payload`, `lib_dto_find_query`, `lib_dto_find_response` | DTO pattern from `.agents` |
| `src/lib/enum.lib.ts` | `enum_presence_status` | Add the room enums here (plan section 4.4) |
| `src/lib/rate-limit.lib.ts` | `lib_rate_limit(redis, key, limit, window_seconds)` | Join, message and invite limits |
| `src/lib/openapi.lib.ts` | `lib_openapi`, `lib_openapi_security` | API docs at `/openapi` (spec at `/openapi/json`); add `detail: { tags, summary, security: lib_openapi_security }` to each DTO entry and errors as `401: lib_dto_error_response` |
| `src/module/main/presence/presence.service.ts` | `service_presence.notify`, `enter_live`, `leave_live` | Send `room.*` events and set `busy`; see [Hooks for the room team](#hooks-for-the-room-team) |

A controller for your module follows this shape:

```typescript
export const controller_room = new Elysia({ prefix: '/room' })

  .use(lib_context)

  .use(lib_jwt)

  .post(
    '/join',
    async (context) => {
      const { payload, body, database, redis } = context;

      return await service_room.join(body, payload, database, redis);
    },
    dto_room.join,
  );
```

Then register it in `app.ts` with `.use(controller_room)`, next to `controller_presence`.

## The 10 steps

### 1. Foundations

- Libs listed above. Still to do: room enums in `enum.lib.ts`, path aliases `@ai`, `@agent`, `@tool` later.
- Done when: `bun run typecheck` passes (see [Known issues](#known-issues)).

### 2. Local LiveKit, shared packages, health

- `infra/compose/compose.dev.yaml` with LiveKit and Redis, `infra/compose/livekit.dev.yaml` with `auto_create: false` and the webhook pointing to `http://host.docker.internal:3000/webhook/livekit` (plan section 14.2).
- Rename `packages/liveChat` to `packages/room-client` (folders are kebab-case). It owns `livekit-client`; the backend only needs `livekit-server-sdk`.
- `packages/contracts/src/room.ts` with topics and event types (plan section 8.6), and `src/lib/livekit.lib.ts` (plan section 8.8).

| Method | Path | Function | What it does |
| --- | --- | --- | --- |
| GET | `/health` | `service_health.find` | Status, version, `livekit_url` |
| GET | `/health/ready` | `service_health.ready` | Checks Turso, Redis and LiveKit |

- Done when: `/health/ready` reports all three as OK.

### 3. Schemas, vault, seed data

- Main DB: `vault`, `room_route`, `room_guest`, `user.user_language`.
- Vault DB: `room`, `room_member`, `participant`, `message`, `audit` (plan section 12).
- New scripts: `db:deploy:tenant` (applies tenant migrations to every vault) and `db:seed` (an organization, a department, 3–4 users with memberships, one vault created by hand with `turso db create <name> --group mawiid-dev`).
- Internal services: `service_vault`, `service_room_route.vault(room_uid)`.
- Done when: the seed prints user ids and a `room_uid` resolves to a working vault client.

### 4. Room CRUD

| Method | Path | Function |
| --- | --- | --- |
| POST | `/room` | `create` |
| GET | `/room` | `find` |
| PATCH | `/room` | `update` |
| DELETE | `/room` | `delete` |

- Also `service_room.authorize(room_uid, payload, database)`, used by every later step.
- Done when: user 1 creates a room with users 2–3; user 4 is refused.

### 5. Room members

| Method | Path | Function |
| --- | --- | --- |
| GET | `/room-member` | `find` |
| POST | `/room-member` | `create` (invite) |
| PATCH | `/room-member` | `update` (role, admit from the lobby) |
| DELETE | `/room-member` | `delete` (remove, optional ban) |

- Done when: roles change, and a banned member is refused.

### 6. Join, leave, close: the first real call

| Method | Path | Function | What it does |
| --- | --- | --- | --- |
| POST | `/room/join` | `join` | Checks, Redis lock, `lib_livekit_ensure`, 5-minute token |
| POST | `/room/leave` | `leave` | Fast signal; the webhook stays the source of truth |
| POST | `/room/close` | `close` | `deleteRoom`, then `service_room.finish` |

- Client: `create_room_session` in `packages/room-client` and a small browser test page where you pick a seeded user.
- Done when: two tabs see and hear each other, and closing disconnects both.

### 7. Webhooks, live state, reconciliation

| Method | Path | Function |
| --- | --- | --- |
| POST | `/webhook/livekit` | `livekit` |
| GET | `/participant` | `find` |

- Internal: `service_room.start`, `service_room.finish`, `service_participant.join`, `service_participant.leave`; Redis sets `room:<uid>:live` and `rooms:live`; a timer sweeper (5 s) and a reconcile loop (60 s).
- `service_participant.join` and `leave` must call `service_presence.enter_live` and `leave_live`.
- Done when: rooms go `open → live → closed` by themselves, and restarting the backend during a call repairs the state.

### 8. Chat

| Method | Path | Function |
| --- | --- | --- |
| POST | `/message` | `create` (save, then `lib_livekit_broadcast`) |
| GET | `/message` | `find` (`before_message_id`, `after_message_id`) |
| PATCH | `/message` | `update` |
| DELETE | `/message` | `delete` |

- Client: accept `mawiid.message.v1` only from the server, show sent messages at once by `message_client_id`, refetch after `Reconnected`.
- Done when: messages reach both tabs, are saved, never duplicate on retry, and survive a reconnect.

### 9. Presence and ringing (done)

| Method | Path | Function |
| --- | --- | --- |
| POST | `/presence/ticket` | `ticket` |
| WS | `/presence/ws?ticket=` | `open`, `message`, `close` |
| GET | `/presence` | `find` |
| PATCH | `/presence` | `update` |
| POST | `/room/decline` | `decline` (room team) |

- Details: [presence-implementation.md](../apps/backend/src/module/main/presence/presence-implementation.md).
- Ringing itself (`room.ring`, `room.declined`, `room.missed`, the 45 s timer) belongs to the room team and uses `service_presence.notify`.

### 10. Moderation, lobby, live controls

| Method | Path | Function |
| --- | --- | --- |
| POST | `/participant/mute` | `mute` |
| POST | `/participant/promote` | `promote` |
| POST | `/participant/demote` | `demote` |
| DELETE | `/participant` | `delete` |
| PATCH | `/participant` | `update` (raised hand, caption language) |

- Room lock and lobby through `PATCH /room`; admit through `PATCH /room-member` with the WebSocket events `room.knock` and `room.admitted`.
- Client: typing and reactions with `publishData`. Every moderation action writes an `audit` row.
- Done when: the host can mute, remove and promote; a removed user cannot get back in; the lobby admits a guest.

## Hooks for the room team

Full guide: [presence-for-room-team.md](../apps/backend/src/module/main/presence/presence-for-room-team.md).

```typescript
await service_presence.notify([`user:${callee_id}`], 'room.ring', { room_uid, caller: { user_id }, busy }, redis);
await service_presence.enter_live(user_id, room_uid, database, redis);
await service_presence.leave_live(user_id, room_uid, database, redis);
```

- `notify(topics, type, data, redis)` sends one event to every socket subscribed to those topics, on every backend instance.
- Topics: `user:<user_id>` (all devices of one user), `department:<department_id>`, `organization:<organization_id>`.
- `enter_live` and `leave_live` show the user as `busy` and back. `leave_live` ignores a `room_uid` that is not the user's current live.

## Startup workflow

**What `app.ts` does at boot:**

1. `@lib/env.lib` checks the required variables and exits with the missing names.
2. `@lib/context.lib` creates the clients: `main_db`, the `vault_db` cache and Redis. All connect when first used.
3. The app registers `lib_middleware_error`, `lib_context`, `/health`, then the controllers (`controller_presence` today; rooms, members, participants, messages and webhooks join here).
4. `.listen(port)`, then `service_presence.start(...)` opens the Redis subscriber for `ws:event` and starts the presence sweeper (every 5 s).
5. On SIGINT or SIGTERM, `app.stop()` runs `onStop`: stop presence, close Redis, close the databases.

Peers will add their background loops (timer sweeper, reconcile) to step 4 the same way.

**Running it locally (Windows terminal):**

1. `docker compose -f infra/compose/compose.dev.yaml up -d` (after step 2).
2. In `.env`: `ENV=dev`, plus the `LIVEKIT_*` values for the local server.
3. From `apps/backend`: `bun run db:generate`, `bun run db:deploy:main`, `bun run db:deploy:tenant`, `bun run db:seed` (after step 3).
4. From the repo root: `bun run dev:backend`.
5. Check `GET /health/ready`, then open the test page in two tabs as two seeded users.

After the first run, repeat only steps 1, 4 and 5, plus migrations when a schema changes.

## Known issues

- `bun run typecheck` fails before checking anything: `apps/backend/tsconfig.json` sets `"ignoreDeprecations": "6.0"`, which the pinned TypeScript 5.9.3 rejects. Use `"5.0"` (or remove the line); until then run `bun x tsc --noEmit --ignoreDeprecations 5.0`.
- `packages/liveChat` should be renamed to `packages/room-client` (kebab-case, plan section 13.1).
- Bun's Redis pub/sub is still marked experimental. It worked in testing against Upstash; if it misbehaves, use another Redis client for the subscriber only.
- Cloud Run cuts WebSockets after 60 minutes, so apps must reconnect (they already do on close), or the gateway must run on a VM or GKE.
