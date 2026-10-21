# Presence and Direct Calls

LiveKit only knows the people inside a room. The backend runs a WebSocket gateway for everything outside rooms: online status, invites, ringing and notifications. Presence state lives in Redis, never in process memory.

`POST /room/decline` belongs to the `room` module; this module sends the events around it.

---

## 1. APIs

### Presence Ticket

| Method | Endpoint           | Function | Who  | Description                             |
| ------ | ------------------ | -------- | ---- | --------------------------------------- |
| `POST` | `/presence/ticket` | `ticket` | User | One-time WebSocket ticket, valid 30 s   |

- Browsers cannot send an `Authorization` header on a WebSocket, and a JWT in a URL ends up in logs, so the app exchanges its JWT for a ticket.
- `SET ws_ticket:<ticket> <user_id> EX 30`.
- Rate limit: 10 per minute per user (`rate:ticket:<user_id>`).

### WebSocket

| Protocol | Endpoint               | Functions                  | Who    |
| -------- | ---------------------- | -------------------------- | ------ |
| `WS`     | `/presence/ws?ticket=` | `open`, `message`, `close` | Ticket |

Lifecycle:

- `open` — consume the ticket with `GETDEL ws_ticket:<ticket>` (single use), subscribe the socket to `user:<user_id>` and to `department:<department_id>` for each team, set `presence:user:<user_id>` with a 45 s TTL and publish `presence.updated`.
- `message` — handle `presence.ping` (refresh the TTL) and `presence.status`.
- `close` — unsubscribe and clean up; the TTL decides when the user is offline.

### Presence Management

| Method  | Endpoint    | Function | Who  | Description                                                |
| ------- | ----------- | -------- | ---- | ---------------------------------------------------------- |
| `GET`   | `/presence` | `find`   | User | Status of a list of `user_id` values                       |
| `PATCH` | `/presence` | `update` | User | Set `online`, `away`, `busy` or `offline` (appear offline) |

---

## 2. Presence Rules

- Statuses (`enum_presence_status`): `online`, `away`, `busy`, `offline`.
- The app sends `presence.ping` every 20 seconds; the backend refreshes `presence:user:<user_id>` (TTL 45 s). No ping for 45 seconds means offline.
- Joining a live sets `busy` automatically (from the `participant_joined` webhook). Leaving sets it back to `online`.
- Anyone can choose `offline` to appear offline.
- Privacy: people see the status of their teammates (same department or organization) and of people they share a room with. `GET /presence` filters out everyone else.

### Multiple Backend Instances

- Every event goes through one Redis pub/sub channel, `ws:event`.
- Each instance forwards it to its own sockets with Bun WebSocket topics (`server.publish(topic, data)`).
- Bun's Redis client needs a dedicated subscriber connection: `redis.duplicate()`, then `subscribe()`. Pub/sub is still experimental in Bun; fall back to another Redis client for the subscriber if it misbehaves.
- Cloud Run limits a WebSocket to 60 minutes: apps must reconnect at least every hour, or the gateway runs on a VM or GKE.

### Redis Keys

| Key                       | Type                 | TTL         | Purpose                      |
| ------------------------- | -------------------- | ----------- | ---------------------------- |
| `ws_ticket:<ticket>`      | string → user id     | 30 s        | One-time WebSocket login     |
| `presence:user:<user_id>` | string (status JSON) | 45 s        | Heartbeat                    |
| `user:<user_id>:live`     | string (room_uid)    | until leave | Busy status and call waiting |
| `timer:room`              | sorted set           | —           | Ring timeouts                |

---

## 3. Events

Every event uses one envelope:

```json
{
  "type": "room.ring",
  "version": 1,
  "data": { "room_uid": "5f0c...", "caller": { "user_id": 42 } },
  "sent_at": "2026-10-20T10:00:00.000Z"
}
```

### Server → App

| Event                | To                      | Data                                   | When                                   |
| -------------------- | ----------------------- | -------------------------------------- | -------------------------------------- |
| `presence.updated`   | Teammates               | `user_id`, `presence_status`           | A status changes                       |
| `room.invited`       | Invitee                 | `room_uid`, `room_title`, `invited_by` | An invite is created                   |
| `room.ring`          | Callee's devices        | `room_uid`, `caller`, `busy`           | A direct call starts                   |
| `room.ring_canceled` | Callee's devices        | `room_uid`, `reason`                   | Answered elsewhere, canceled or missed |
| `room.declined`      | Caller                  | `room_uid`, `user_id`                  | The callee declined                    |
| `room.missed`        | Caller                  | `room_uid`                             | Ring timeout                           |
| `room.knock`         | Hosts, moderators       | `room_uid`, `user_id`                  | Someone waits in the lobby             |
| `room.admitted`      | Guest                   | `room_uid`                             | A host admitted them                   |
| `room.started`       | Members                 | `room_uid`                             | The live began                         |
| `room.closed`        | Members                 | `room_uid`, `room_close_reason`        | The live ended                         |
| `message.created`    | Members not in the live | `room_uid`, `message_id`, preview      | New message, for badges                |
| `summary.created`    | Participants            | `room_uid`                             | The recap is ready                     |

### App → Server

- `presence.ping` every 20 seconds.
- `presence.status` with `online`, `away`, `busy` or `offline`.

Event types and payloads are shared through `packages/contracts`. Version every event; a breaking change gets a new version.

---

## 4. Direct Call Lifecycle

1. The caller creates the room with `POST /room` (`room_type: 'direct'`, callee user id) and joins with `POST /room/join`.
2. The backend adds a ring deadline to `timer:room` (`ROOM_RING_TIMEOUT_SECONDS`, 45 s).
3. The callee rings on **every device**: `room.ring` over the WebSocket on open apps, VoIP push on mobile when offline (CallKit on iOS, full-screen call notification on Android). Push tokens come from the `device` module.
4. If the callee is already `busy`, `room.ring` carries `busy: true` and the UI offers "Decline and send a message".
5. The callee can:
   - **Accept** — call `POST /room/join` and connect. The other devices receive `room.ring_canceled` (`reason: answered`).
   - **Decline** — call `POST /room/decline`. The backend calls `deleteRoom`, runs `finish(room_uid, 'declined')` and sends `room.declined` to the caller.
6. If the caller hangs up before an answer, the callee's devices receive `room.ring_canceled` (`reason: canceled`) and the room closes with `canceled`.
7. If nobody answers within **45 seconds**, the `timer:room` sweeper calls `deleteRoom`, runs `finish(room_uid, 'missed')`, sends `room.missed` to the caller and `room.ring_canceled` (`reason: missed`) to the callee.
8. During the call, when either side leaves, the backend closes the room for both.
9. When the room closes, members receive `room.closed`.

The timeout runs in the Redis sweeper (one instance holding `lock:timer`, every 5 s), never in an in-process `setTimeout`.

---

## 5. Acceptance Criteria

- User 1 appears online to user 2, who is a teammate.
- A user who is not a teammate and shares no room cannot see user 1's status.
- Presence changes are propagated through WebSocket events across several backend instances.
- A user who stops pinging is offline after 45 seconds.
- A user in a live appears `busy`; leaving sets them back to `online`.
- A ticket works only once and expires after 30 seconds.
- A direct call initiated by user 1 causes all of user 2's devices to ring, including through push when the app is closed.
- User 2 can accept the call and join the room; the other devices stop ringing.
- User 2 can decline the call, notifying user 1.
- If user 2 does not answer within 45 seconds, the call is marked as missed.
- Call cancellation and room closure are propagated to the relevant participants.
