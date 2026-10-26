# Presence for the Room and Participant Modules

_Last updated: 2026-10-21 · For the developers of `room`, `room-member` and `participant`_

Presence owns the WebSocket that every app keeps open. Your modules never touch that socket or the presence Redis keys. You call three functions of `service_presence`, and presence delivers the events to the right devices on every backend instance.

```text
room / room-member / participant  ──calls──►  service_presence  ──►  Redis ws:event  ──►  apps
```

- Import: `import { service_presence } from '@module/main/presence/presence.service';`
- Direction: your modules import presence; presence never imports them.
- `database` and `redis` are the same clients your handlers get from `lib_middleware_context` (decorated in `app.ts`).

## 1. The three functions

### `notify(topics, type, data, redis)`

Sends one real-time event to everyone subscribed to the given topics.

```typescript
await service_presence.notify(
  [`user:${callee_id}`],
  'room.ring',
  {
    room_uid: room.room_uid,
    caller: { user_id: payload.user_id },
    busy: false,
  },
  redis,
);
```

- `topics`: who receives it.
  - `user:<user_id>`: all open devices of that user. Use this for almost everything.
  - `department:<department_id>` and `organization:<organization_id>`: everyone in that team or organization.
- `type`: the event name from the table in section 2.
- `data`: a plain JSON object. Keep it small; send ids, not whole records.
- Presence wraps it in the envelope the apps expect: `{ type, version: 1, data, sent_at }`.
- It goes through Redis, so it reaches users connected to any backend instance.
- If the user has no open socket, the event is lost. That is fine for UI updates. For an incoming call to someone offline, push notifications (the `device` module) are needed in addition.

### `enter_live(user_id, room_uid, database, redis)`

Marks the user as in a meeting. Their teammates see them as `busy`.

### `leave_live(user_id, room_uid, database, redis)`

Clears it. Teammates see the user's normal status again.

- It does nothing if `room_uid` is not the user's current meeting, so a late event from an old room cannot clear a newer one.
- The busy flag has a 6-hour safety TTL in case a leave is lost.

## 2. Where to call them

| Moment                               | Your function                                                                               | Presence call                                                                   | Topics                                    | `data`                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| A user is invited                    | `service_room_member.create`                                                                | `notify(..., 'room.invited', ...)`                                              | `user:<invitee>`                          | `{ room_uid, room_title, invited_by }`           |
| A direct call starts                 | `service_room.create` (`direct`)                                                            | `notify(..., 'room.ring', ...)`                                                 | `user:<callee>`                           | `{ room_uid, caller: { user_id }, busy }`        |
| The callee answers                   | `service_room.join` (callee of a ringing direct room)                                       | `notify(..., 'room.ring_canceled', ...)`                                        | `user:<callee>`                           | `{ room_uid, reason: 'answered' }`               |
| The callee declines                  | `service_room.decline`                                                                      | `notify(..., 'room.declined', ...)`                                             | `user:<caller>`                           | `{ room_uid, user_id }`                          |
| The caller hangs up before an answer | `service_room.finish` (`canceled`)                                                          | `notify(..., 'room.ring_canceled', ...)`                                        | `user:<callee>`                           | `{ room_uid, reason: 'canceled' }`               |
| Nobody answers in 45 s               | Ring timer sweeper                                                                          | `notify(..., 'room.missed', ...)` and `notify(..., 'room.ring_canceled', ...)`  | `user:<caller>`, `user:<callee>`          | `{ room_uid }`, `{ room_uid, reason: 'missed' }` |
| Someone waits in the lobby           | `service_room.join` (status `waiting`)                                                      | `notify(..., 'room.knock', ...)`                                                | `user:<host>` for each host and moderator | `{ room_uid, user_id }`                          |
| A host admits them                   | `service_room_member.update`                                                                | `notify(..., 'room.admitted', ...)`                                             | `user:<guest>`                            | `{ room_uid }`                                   |
| The meeting goes live                | `service_room.start` (webhook `room_started`)                                               | `notify(..., 'room.started', ...)`                                              | `user:<member>` for each member           | `{ room_uid }`                                   |
| A user really joins                  | `service_participant.join` (webhook `participant_joined`)                                   | `enter_live(user_id, room_uid, ...)`                                            | —                                         | —                                                |
| A user leaves                        | `service_participant.leave` (webhooks `participant_left`, `participant_connection_aborted`) | `leave_live(user_id, room_uid, ...)`                                            | —                                         | —                                                |
| The meeting ends                     | `service_room.finish`                                                                       | `leave_live` for each user still inside, then `notify(..., 'room.closed', ...)` | `user:<member>` for each member           | `{ room_uid, room_close_reason }`                |

The event names and `data` shapes above are the contract the frontend is building against (see `docs/frontend-presence-integration.md`). Changing one means telling the frontend developer.

## 3. Code examples

**Participant webhook handlers:**

```typescript
import type { RedisClient } from 'bun';
import type { WebhookEvent } from 'livekit-server-sdk';
import type { create_database_client } from '@db/client.db';
import { service_presence } from '@module/main/presence/presence.service';

function participant_user_id(event: WebhookEvent) {
  const identity = event.participant?.identity ?? '';
  if (!identity.startsWith('user_')) return null;
  const user_id = Number(identity.slice('user_'.length));
  return Number.isInteger(user_id) && user_id > 0 ? user_id : null;
}

export const service_participant = {
  async join(
    event: WebhookEvent,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ) {
    const user_id = participant_user_id(event);
    if (!user_id || !event.room) return;
    await service_presence.enter_live(
      user_id,
      event.room.name,
      database,
      redis,
    );
  },

  async leave(
    event: WebhookEvent,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ) {
    const user_id = participant_user_id(event);
    if (!user_id || !event.room) return;
    await service_presence.leave_live(
      user_id,
      event.room.name,
      database,
      redis,
    );
  },
};
```

AI agents join with identities that do not start with `user_`, so they are skipped.

**Closing a meeting:**

```typescript
const member_ids = members.map((member) => member.user_id);

await Promise.all(
  member_ids.map((user_id) =>
    service_presence.leave_live(user_id, room.room_uid, database, redis),
  ),
);

await service_presence.notify(
  member_ids.map((user_id) => `user:${user_id}`),
  'room.closed',
  { room_uid: room.room_uid, room_close_reason: reason },
  redis,
);
```

Calling `leave_live` for every member is safe: it only clears users whose current meeting is this room.

## 4. Rules

1. **Never write presence Redis keys yourself** (`presence:*`, `user:<id>:live`, `ws_ticket:*`). Always go through `service_presence`. This is the "data only through services" rule from `.agents`.
2. **`busy` comes from webhooks, not from `POST /room/join`.** A user who receives a token may never connect.
3. **Always clean up in `finish`.** If LiveKit webhooks are lost, `finish` is the last chance to clear `busy`.
4. **Send ids, not records.** The frontend fetches details through your HTTP endpoints when it needs them.
5. **Use `user:<id>` topics for room events.** Department and organization topics reach many people; use them only for events meant for the whole team.
6. **Events are best effort.** An app that was offline misses them. Your HTTP endpoints must always return the current truth (for example, `GET /room` shows the room as closed), and apps reload after reconnecting.

## 5. Not built yet (ask Omar)

These are planned for presence because your modules will need them:

| Need                                                   | Planned function                                                                                   | Why                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Is the callee connected or already busy?               | `service_presence.state(user_id, redis)` returning `{ presence_status, connected, live_room_uid }` | Set `busy` in `room.ring`, and choose between WebSocket and push notification |
| Topic names without typos                              | `service_presence.topic.user(id)`, `.department(id)`, `.organization(id)`                          | One misspelled topic and the event silently goes nowhere                      |
| People in the same meeting can see each other's status | Visibility check extended with `room_member`                                                       | Needs your `room_member` table first                                          |

Until `state` exists, send `busy: false` in `room.ring`. Until the topic helpers exist, write `` `user:${user_id}` `` exactly as in the examples.

## 6. Testing your calls

- Unit tests: `presence.test.ts` shows how to fake Redis and the database. Record what `notify` publishes and assert the topics, `type` and `data`.
- By hand: open a presence socket as user 2 (see `docs/frontend-presence-integration.md`, section 10), then trigger your endpoint as user 1 with `x-user-id: 1`. User 2's socket prints the event.
