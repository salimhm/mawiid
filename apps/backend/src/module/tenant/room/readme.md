# Room Management

A Mawiid live is one room. The room record lives in the owner's vault (`src/module/tenant/room`), and the main database keeps a `room_route` (`room_uid → vault`) so any backend instance can find it. LiveKit only knows who is connected right now; the backend and the vault are the source of truth.

Related modules: `room-member`, `participant`, `message` (tenant), `presence`, `webhook` (main).

---

## 1. Concepts

### Room Types

| Type      | People   | Who publishes               | How people arrive                              | How it ends                                                          |
| --------- | -------- | --------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `direct`  | 2        | Both                        | The caller rings the callee                    | Either side hangs up, the callee declines, or nobody answers in 45 s |
| `group`   | 3–12     | Everyone                    | Invites, a link, or the team's "Live now" list | The host closes it, or everyone leaves                               |
| `webinar` | 13+      | Hosts and promoted speakers | Invite or link; the audience listens           | The host closes it                                                   |

### Status Lifecycle

| From        | To       | When                                                         |
| ----------- | -------- | ------------------------------------------------------------ |
| —           | `scheduled` | Created with a future time                                |
| —           | `open`   | Created for now                                              |
| `scheduled` | `open`   | Start window reached                                         |
| `scheduled` | `closed` | Canceled or expired                                          |
| `open`      | `live`   | `room_started` webhook (first participant connects)          |
| `open`      | `closed` | Never joined, missed or declined                             |
| `live`      | `closed` | Host ends, room empty, max duration or direct hang-up        |

The LiveKit room is created lazily at the first `POST /room/join`, so a scheduled live never hits LiveKit's `empty_timeout`.

### Enums (`@lib/enum.lib`)

- `enum_room_type`: `direct`, `group`, `webinar`
- `enum_room_status`: `scheduled`, `open`, `live`, `closed`
- `enum_room_close_reason`: `ended`, `empty`, `missed`, `declined`, `canceled`, `expired`, `max_duration`
- `enum_room_visibility`: `private`, `department`

Schema columns stay `String`; DTOs check requests with `t.UnionEnum`.

### Identity Rules

- `room_uid` is a random UUID from `crypto.randomUUID()` and is the LiveKit room name.
- Never put a title, name or phone number in `room_uid` or a participant identity; LiveKit logs both.
- Participant identity is `user_<user_id>`. One session per user per room: joining from a second device disconnects the first with `DUPLICATE_IDENTITY`.

---

## 2. Room CRUD

### APIs

| Method   | Endpoint | Function | Who                  | Description                                                                         |
| -------- | -------- | -------- | -------------------- | ----------------------------------------------------------------------------------- |
| `POST`   | `/room`  | `create` | `room.create` access | Create a live with its settings and first members; writes `room_route` in main DB   |
| `GET`    | `/room`  | `find`   | Member               | My lives; filters `room_uid[]`, `room_status[]`, `room_type[]`                      |
| `PATCH`  | `/room`  | `update` | Host, moderator      | Title, schedule, `room_locked`, `room_lobby_enabled`, translation, recording        |
| `DELETE` | `/room`  | `delete` | Host                 | Soft-delete a `scheduled` or `closed` live; a scheduled one closes with `canceled`  |

### Room Settings (`PATCH /room`)

- **Room lock** (`room_locked`): new joins are refused with `room-locked`, except for the host.
- **Lobby** (`room_lobby_enabled`): guests wait for approval (see `room-member`).
- Settings are saved in the vault `room` row, then copied to LiveKit room metadata with `updateRoomMetadata`. Clients read them from `room.metadata` and `RoomMetadataChanged`; only the backend can change them.

Room metadata:

```json
{
  "room_type": "group",
  "room_locked": false,
  "room_translation_enabled": true,
  "room_recording": false,
  "room_encrypted": false
}
```

### "Live now"

An open live with `room_visibility: 'department'` appears in `GET /room?room_status=live` for that department. Anyone in the department can join; the backend adds them as `member` on join.

### Authorization

- Implement `service_room.authorize(room_uid, payload, database)`.
- It resolves the vault through `room_route`, loads the room, the caller's `room_member` row and the user.
- It throws `room_not_found` when the room does not exist, and `forbidden` when the caller is not a member or is banned (`room_member_banned_at` set).
- Every room, room-member, participant and message operation goes through `service_room.authorize`.

### Acceptance Criteria

- User 1 can create a room and add users 2 and 3.
- User 4, who is not authorized to access the room, is refused access.

---

## 3. Join, Leave, Decline and Close

### APIs

| Method | Endpoint        | Function  | Who             | Description                                                              |
| ------ | --------------- | --------- | --------------- | ------------------------------------------------------------------------ |
| `POST` | `/room/join`    | `join`    | Member          | Run checks, ensure the LiveKit room, return `server_url` and `participant_token` |
| `POST` | `/room/leave`   | `leave`   | Participant     | Optional fast signal; the `participant_left` webhook is the source of truth |
| `POST` | `/room/decline` | `decline` | Invitee         | Decline a ring or an invite                                              |
| `POST` | `/room/close`   | `close`   | Host, moderator | End the live for everyone                                                |

### Join Flow

`POST /room/join` must, in order:

1. Rate limit: 10 per minute per user (`rate:join:<user_id>`).
2. Call `service_room.authorize` (not found, not a member, banned → refuse).
3. `room_status` is `closed` → `410 room-closed`.
4. `room_member_status` is `waiting` (lobby) → `403 room-waiting`.
5. `room_locked` and the caller is not the host → `423 room-locked`.
6. Soft capacity check: `SCARD room:<room_uid>:live` ≥ `room_max_participants` → `409 room-full`.
7. Plan limit: concurrent lives per tenant from `vault:<vault_id>:live`.
8. Acquire the Redis lock `lock:room:<room_uid>` (`SET ... NX PX 5000`) so two people joining at the same second do not race to create the room.
9. Create or ensure the LiveKit room with `lib_livekit_ensure` (`maxParticipants` is the hard limit, `emptyTimeout: 300`, `departureTimeout: 20`).
10. Mint a LiveKit token with `lib_livekit_token`, valid for **5 minutes**, for this room only.
11. Return `server_url`, `participant_token`, `room` and `room_member_role`.

Clients call `POST /room/join` on every join and rejoin so permission checks always run.

### Token Grants per Role

| Grant                                               | host                                                 | moderator    | member                           | viewer                       |
| --------------------------------------------------- | ---------------------------------------------------- | ------------ | -------------------------------- | ---------------------------- |
| `roomJoin` + `room`                                 | Yes                                                  | Yes          | Yes                              | Yes                          |
| `canSubscribe`                                      | Yes                                                  | Yes          | Yes                              | Yes                          |
| `canPublish`                                        | Yes                                                  | Yes          | Yes                              | No                           |
| `canPublishSources`                                 | camera, microphone, screen share, screen share audio | Same as host | camera, microphone, screen share | —                            |
| `canPublishData`                                    | Yes                                                  | Yes          | Yes                              | Yes (typing, reactions, RPC) |
| `canUpdateOwnMetadata`                              | No                                                   | No           | No                               | No                           |
| `roomAdmin`, `roomCreate`, `roomList`, `roomRecord` | Never; only the backend uses these powers            |              |                                  |                              |

- Always set `canPublish` and `canSubscribe` explicitly.
- Server-set attributes in the token: `mawiid.user_id`, `mawiid.role`, `mawiid.language`.
- Self-hosted LiveKit does not revoke tokens, hence the short TTL.

### Leave Flow

- `POST /room/leave` is optional; the app calls `room.disconnect()` and the `participant_left` webhook records attendance.
- In a `direct` room, when one side leaves the backend calls `deleteRoom` and closes it for both (`ended`).
- When the host leaves a `group` or `webinar`, the live continues: the backend promotes the moderator who joined first, or in a group the member who joined first, and updates `mawiid.role`.
- A webinar left without any host or moderator for 5 minutes closes with `ended`.

### Decline Flow

1. The invitee calls `POST /room/decline`.
2. For a `direct` room, the backend calls `deleteRoom` and runs `finish(room_uid, 'declined')`.
3. The caller receives `room.declined` (see `presence`).

### Close Flow

1. `POST /room/close` checks the caller is host or moderator.
2. Call LiveKit `deleteRoom(room_uid)`; every client receives `Disconnected(ROOM_DELETED)`.
3. LiveKit sends `room_finished`; the webhook calls `service_room.finish(room_uid, reason)`.

### Closing Paths

| Trigger                           | Detected by                                        | Action                                    | `room_close_reason` |
| --------------------------------- | -------------------------------------------------- | ----------------------------------------- | ------------------- |
| Host clicks "End for everyone"    | `POST /room/close`                                 | `deleteRoom`                              | `ended`             |
| Everyone left                     | `room_finished` after `departure_timeout` (20 s)   | `finish()`                                | `empty`             |
| One side hangs up a direct call   | `participant_left` in a `direct` room              | `deleteRoom`                              | `ended`             |
| The callee declines               | `POST /room/decline`                               | `deleteRoom`                              | `declined`          |
| No answer in 45 s                 | `timer:room` sweeper                               | `deleteRoom`, `room.missed` to the caller | `missed`            |
| The host cancels a scheduled live | `DELETE /room`                                     | No LiveKit room exists yet                | `canceled`          |
| A scheduled live never started    | Sweeper, 2 h after `room_scheduled_at`             | None                                      | `expired`           |
| Maximum duration reached          | Sweeper (`ROOM_MAX_DURATION_MINUTES`)              | `deleteRoom`                              | `max_duration`      |

### `service_room.finish(room_uid, reason)`

Every closing path ends here. It must be idempotent:

1. If the room is already `closed`, stop. The first reason wins.
2. Set `room_status = 'closed'`, `room_closed_at` and `room_close_reason`.
3. Close open `participant` rows. Clear `room:<room_uid>:live`, `user:<user_id>:live`, `room_key:<room_uid>` and the `rooms:live` entry. Set presence back to `online`.
4. End agent work (and recording, later).
5. Queue post-live jobs (summary, transcript clean-up) unless the room is encrypted.
6. Write an `audit` row and send `room.closed` over the WebSocket.

`service_room.start(room_uid)` (from `room_started`) sets `room_status = 'live'`, `room_started_at`, adds the room to `rooms:live` and sends `room.started`.

### Timers

Ring timeouts, maximum duration and scheduled expiry use the Redis sorted set `timer:room` (score = deadline). One instance holding `lock:timer` sweeps it every 5 seconds. Never use in-process `setTimeout`: the backend is stateless.

### Error Codes

| Code                  | Status | When                                 |
| --------------------- | ------ | ------------------------------------ |
| `room-not-found`      | 404    | Unknown `room_uid`                   |
| `forbidden`           | 403    | Not a member, banned, or wrong role  |
| `room-waiting`        | 403    | Waiting in the lobby                 |
| `room-full`           | 409    | Capacity reached                     |
| `room-closed`         | 410    | Room already closed                  |
| `room-locked`         | 423    | Room locked                          |
| `too-many-requests`   | 429    | Rate limit reached                   |
| `livekit-unavailable` | 503    | LiveKit API call failed              |

### Client Implementation

- Move `services/liveChat/` to `packages/room-client/` (kebab-case, shared TypeScript).
- Implement `create_room_session` in `packages/room-client`.
- Room options: `adaptiveStream: true`, `dynacast: true`, simulcast on; echo cancellation, noise suppression and auto gain on.
- Build a small browser-based test page.
- Allow users to select from seeded test users.

### Acceptance Criteria

- Two browser tabs can join the same room.
- Both participants can hear and see each other.
- Closing the room disconnects both participants, and the vault shows the room `closed` with `room_close_reason = 'ended'`.
- Two users joining at the same moment create only one LiveKit room.
- A locked room refuses new joins; a closed room returns `room-closed`.
- A full room returns `room-full`.
- Calling `finish` twice keeps the first close reason.
- Hanging up a direct call closes it for both sides.
