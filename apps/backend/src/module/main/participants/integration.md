# Participants Module: Integration Guide

How a client (web or mobile) integrates the participant moderation, room lock, lobby, audit log and realtime event endpoints. For the feature requirements see [readme.md](./readme.md).

---

## 1. Basics

### Base URL

```
http://localhost:3000        # local (BACKEND_PORT)
ws://localhost:3000          # local WebSocket
```

### Authentication

Every HTTP endpoint except `/webhook/livekit` requires a JWT signed with `JWT_SECRET_KEY`. The token carries `user_id`.

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

The actor is always taken from the token, never from the body. The `user_id` field in a body is always the **target** user.

### Response shape

Success responses wrap the result in `data`:

```json
{ "data": { ... } }
```

Errors return only a code:

```json
{ "code": "room-locked" }
```

| Status | Code                    | When                                                                            |
| ------ | ----------------------- | ------------------------------------------------------------------------------- |
| 400    | `bad-request`           | Invalid action for the current state (e.g. promote a non-viewer, empty update)  |
| 401    | `unauthorized`          | Missing or malformed `Authorization` header                                     |
| 401    | `invalid-token`         | JWT invalid or expired; invalid webhook signature                               |
| 403    | `forbidden`             | Not a member, banned, blocked, declined, or not allowed to moderate this target |
| 403    | `room-waiting`          | Lobby is on and you are waiting for approval                                    |
| 404    | `room-not-found`        | Unknown `room_uid`                                                              |
| 404    | `room-member-not-found` | Target user is not a member of the room                                         |
| 404    | `participant-not-found` | Target is not currently connected to the LiveKit room                           |
| 404    | `track-not-found`       | Target has no published track of that source                                    |
| 410    | `room-closed`           | Room status is `closed`                                                         |
| 422    | `unprocessable-entity`  | Body or query failed schema validation                                          |
| 423    | `room-locked`           | Room is locked and you are not the host                                         |
| 500    | `internal-server-error` | Unexpected failure                                                              |
| 503    | `livekit-unavailable`   | LiveKit could not be reached                                                    |

### Roles and permissions

Roles from highest to lowest: `host` > `moderator` > `member` > `viewer`.

| Role        | Can publish                                          | Can moderate               |
| ----------- | ---------------------------------------------------- | -------------------------- |
| `host`      | camera, microphone, screen share, screen share audio | anyone except themselves   |
| `moderator` | camera, microphone, screen share, screen share audio | only `member` and `viewer` |
| `member`    | camera, microphone, screen share                     | no                         |
| `viewer`    | nothing (subscribe and data messages only)           | no                         |

Moderation rules that apply to every moderation endpoint:

- The actor must be `host` or `moderator`.
- Nobody can moderate themselves.
- A moderator cannot act on another moderator or on the host.
- Only the host can assign or remove the `host` / `moderator` roles.

Member statuses: `invited`, `waiting`, `active`, `declined`.

---

## 2. Joining a room

### `POST /room/join`

Returns a LiveKit token for the caller. Call it every time the user enters or re-enters a room.

```json
// request
{ "room_uid": "7d0f6c1e-6a3e-4b8b-9a51-1f0f3e2a9c10" }
```

```json
// 200
{
  "data": {
    "server_url": "ws://localhost:7880",
    "participant_token": "<livekit jwt>",
    "room_member_role": "member",
    "room": {
      "room_id": 1,
      "room_uid": "7d0f6c1e-...",
      "room_title": "Postman test live",
      "room_status": "open",
      "room_locked": false,
      "room_lobby_enabled": false,
      "room_max_participants": 12,
      "...": "..."
    }
  }
}
```

Checks run in this order:

1. Caller must be a member that is not banned or blocked: otherwise `403 forbidden`.
2. Room must not be `closed`: otherwise `410 room-closed`.
3. Member status must not be `declined`: otherwise `403 forbidden`.
4. If the room is locked, only the host may join: otherwise `423 room-locked`.
5. If the lobby is enabled and the caller is not staff and not yet `active`, the caller is marked `waiting`, staff receive `room.knock`, and the response is `403 room-waiting`. See [Lobby flow](#4-lobby-flow).

Connect to LiveKit with the result:

```ts
import { Room } from 'livekit-client';

const res = await fetch(`${base_url}/room/join`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ room_uid }),
});
const body = await res.json();
if (!res.ok) throw new Error(body.code); // 'room-waiting', 'room-locked', ...

const room = new Room();
await room.connect(body.data.server_url, body.data.participant_token);
```

LiveKit identities have the form `user_<user_id>`. The role is exposed as the participant attribute `mawiid.role`.

---

## 3. Room settings: lock and lobby

### `PATCH /room` (host or moderator)

```json
{
  "room_uid": "7d0f6c1e-...",
  "room_locked": true, // optional
  "room_lobby_enabled": true // optional
}
```

Returns `{ "data": <room> }`. If nothing changes, it returns the room without writing an audit row. Changes are written to the audit log as `room.update` and copied into the LiveKit room metadata, so connected clients can react through `RoomEvent.RoomMetadataChanged`:

```json
{
  "room_type": "group",
  "room_locked": true,
  "room_lobby_enabled": true,
  "room_translation_enabled": false,
  "room_recording": false,
  "room_encrypted": false
}
```

- **Locked**: nobody except the host can get a join token. People already connected stay connected.
- **Lobby**: non-staff members who are not `active` must be admitted before they get a token.

---

## 4. Lobby flow

```
Guest                        Backend                         Host / Moderator
  |  POST /event/ticket  ------>|                                 |
  |  WS /event/ws?ticket ------>|<------ (staff also connected) --|
  |  POST /room/join     ------>|                                 |
  |<----- 403 room-waiting -----|---- WS room.knock {user_id} --->|
  |                             |<--- PATCH /room-member ---------|
  |                             |     { room_member_status:       |
  |                             |       "active" }                |
  |<---- WS room.admitted ------|   i                              |
  |  POST /room/join     ------>|                                 |
  |<----- 200 token ------------|                                 |
```

1. Guest and staff both keep a realtime socket open ([section 7](#7-realtime-events-websocket)).
2. Guest calls `POST /room/join` and gets `403 room-waiting`. Show a "waiting for host" screen.
3. Staff receive `room.knock` with `{ room_uid, user_id }`. The knock is sent at most once every 10 seconds per guest, so repeated join attempts don't spam the host.
4. Host admits the guest with `PATCH /room-member` (`"active"`) or denies them (`"declined"`).
5. Guest receives `room.admitted` and calls `POST /room/join` again, which now returns a token.

A declined guest gets `403 forbidden` on later joins until a staff member sets them back to `active`.

---

## 5. Room members

### `PATCH /room-member` (host or moderator): admit, deny, change role

```json
{
  "room_uid": "7d0f6c1e-...",
  "user_id": 42,
  "room_member_status": "active", // optional: "active" | "declined"
  "room_member_role": "member" // optional: "host" | "moderator" | "member" | "viewer"
}
```

At least one of `room_member_status` and `room_member_role` is required (`400` otherwise).

Allowed status changes:

| New status | Allowed from                     | Audit action  | Event sent                |
| ---------- | -------------------------------- | ------------- | ------------------------- |
| `active`   | `invited`, `waiting`, `declined` | `lobby.admit` | `room.admitted` to target |
| `declined` | `invited`, `waiting`             | `lobby.deny`  | none                      |

A role change is written as `room_member.role`. If the target is connected, their LiveKit publish permissions are updated live and they receive a `participant.role_changed` data message.

Returns `{ "data": <room_member> }`:

```json
{
  "data": {
    "room_member_id": 5,
    "room_id": 1,
    "user_id": 42,
    "room_member_role": "member",
    "room_member_status": "active",
    "room_member_banned_at": null,
    "created_at": "2026-10-22T10:00:00.000Z",
    "deleted_at": null
  }
}
```

### `DELETE /room-member` (host or moderator): remove or ban

```json
{ "room_uid": "7d0f6c1e-...", "user_id": 42, "ban": true }
```

- Without `ban`: removes the membership (`room_member.delete`) and disconnects the user. They can be invited again later.
- With `ban: true`: also sets `room_member_banned_at` (`room_member.ban`). A banned user gets `403 forbidden` on every room endpoint, including `/room/join`, permanently.

---

## 6. Participant moderation

These act on users who are **connected** to the LiveKit room.

### `POST /participant/mute` (host or moderator)

```json
{
  "room_uid": "7d0f6c1e-...",
  "user_id": 42,
  "track_source": "microphone", // "camera" | "microphone" | "screen_share" | "screen_share_audio"
  "muted": true
}
```

- `muted: true`: the server mutes the target's tracks of that source. The target receives a `participant.muted` data message. Audit action: `participant.mute`.
- `muted: false`: the server **cannot** unmute someone, for privacy reasons. It sends a `participant.unmute_requested` message, and the target's client should ask the user to unmute. Audit action: `participant.unmute_request`.

Errors: `404 participant-not-found` if the target isn't connected, `404 track-not-found` if they have no track of that source.

### `POST /participant/promote` (host or moderator)

```json
{ "room_uid": "7d0f6c1e-...", "user_id": 42 }
```

Promotes `viewer` → `member` so they can publish. Any other current role returns `400`. Audit action: `participant.promote`.

### `POST /participant/demote` (host or moderator)

```json
{ "room_uid": "7d0f6c1e-...", "user_id": 42 }
```

Demotes `member` or `moderator` → `viewer`, which removes their publish permissions. Any other current role returns `400`. Audit action: `participant.demote`.

Promote and demote update the member record and the live LiveKit permissions, and send a `participant.role_changed` data message to the target.

### `DELETE /participant` (host or moderator): kick

```json
{ "room_uid": "7d0f6c1e-...", "user_id": 42, "block_minutes": 15 }
```

Disconnects the target immediately. With `block_minutes` (1–10080, up to 7 days), the target also gets `403 forbidden` on the room until the block expires. Membership is kept. Audit action: `participant.remove`.

Returns `404 participant-not-found` if the target isn't connected and no `block_minutes` was given.

### `PATCH /participant` (any connected member, for themselves)

```json
{
  "room_uid": "7d0f6c1e-...",
  "participant_hand_raised": true, // optional
  "participant_language": "fr" // optional, e.g. "ar", "en-US"
}
```

Updates the caller's own LiveKit attributes `mawiid.hand_raised` (`"true"` or empty) and `mawiid.language`. Other clients see the change through `RoomEvent.ParticipantAttributesChanged`. At least one field is required (`400` otherwise).

All participant endpoints return:

```json
{
  "data": {
    "room_uid": "7d0f6c1e-...",
    "user_id": 42,
    "room_member_role": "member",
    "participant_attributes": {
      "mawiid.role": "member",
      "mawiid.hand_raised": "true"
    }
  }
}
```

---

## 7. Realtime events (WebSocket)

The lobby events (`room.knock`, `room.admitted`) travel over the backend WebSocket, because the guest isn't connected to LiveKit yet.

### Step 1: `POST /event/ticket` (authenticated)

```json
// 200
{ "data": { "ticket": "c1f3...-uuid", "expires_in": 30 } }
```

The ticket is single use and expires after 30 seconds. Browsers can't send an `Authorization` header on a WebSocket, so the ticket is used instead.

### Step 2: connect

```
ws://localhost:3000/event/ws?ticket=<ticket>
```

- If the ticket is invalid or expired, the socket closes with code `4401` and reason `invalid-ticket`. Get a new ticket and reconnect.
- Send the text `ping` about every 20 seconds. The server replies `pong`.
- Fetch a new ticket for every reconnect.

### Envelope

```json
{
  "type": "room.knock",
  "version": 1,
  "data": { "room_uid": "7d0f6c1e-...", "user_id": 42 },
  "sent_at": "2026-10-22T10:00:00.000Z"
}
```

| Type            | Sent to                              | `data`                  |
| --------------- | ------------------------------------ | ----------------------- |
| `room.knock`    | every host and moderator of the room | `{ room_uid, user_id }` |
| `room.admitted` | the admitted guest                   | `{ room_uid }`          |

---

## 8. In-room data messages (LiveKit)

Typing, reactions and moderation notices use LiveKit data messages, not the backend. Topics and limits come from `@contracts/room`.

| Topic                  | Sender          | Payload                                                                         |
| ---------------------- | --------------- | ------------------------------------------------------------------------------- |
| `mawiid.typing.v1`     | any participant | `{ "type": "typing", "typing": true }` (unreliable)                             |
| `mawiid.reaction.v1`   | any participant | `{ "type": "reaction", "reaction_id": "<uuid>", "reaction": "👍" }` (reliable)  |
| `mawiid.moderation.v1` | **server only** | `participant.muted`, `participant.unmute_requested`, `participant.role_changed` |

Limits (`room_signal_limit`):

- Payload at most 1024 bytes.
- Typing sent at most once every 3 s. Receivers clear the "typing" state after 5 s without an update.
- Reactions: at most 16 characters, at most one every 250 ms.

Moderation messages must be ignored if they come from a participant: only messages with no sender (i.e. from the server) are trusted. The client helper below already does this.

---

## 9. Client helper (`participant.client.ts`)

`participant.client.ts` wraps both the socket and the data messages. Import it into the frontend (it depends on `livekit-client` and `@contracts/room`).

### Lobby socket

```ts
import { create_participant_socket } from '<path>/participant.client';

const socket = create_participant_socket(
  base_url,
  async () => {
    const res = await fetch(`${base_url}/event/ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    });
    return (await res.json()).data.ticket;
  },
  {
    on_knock: ({ room_uid, user_id }) => show_admit_prompt(room_uid, user_id), // host UI
    on_admitted: ({ room_uid }) => console.log('admitted to', room_uid),
  },
);

// Guest: join, and wait in the lobby if needed
async function enter(room_uid: string) {
  let res = await join(room_uid);
  if (
    res.status === 403 &&
    (await res.clone().json()).code === 'room-waiting'
  ) {
    await socket.wait_admitted(room_uid);
    res = await join(room_uid);
  }
  return res;
}

// On logout / unmount
socket.close();
```

The helper reconnects automatically with exponential backoff (up to 30 s), requests a new ticket each time, and sends pings.

### Typing, reactions and moderation notices

```ts
import { create_participant_signal } from '<path>/participant.client';

const signal = create_participant_signal(room, {
  on_typing: (identity, typing) => set_typing(identity, typing),
  on_reaction: (identity, { reaction }) => show_reaction(identity, reaction),
  on_moderation: (event) => {
    if (event.type === 'participant.muted')
      toast(`Your ${event.track_source} was muted`);
    if (event.type === 'participant.unmute_requested')
      ask_to_unmute(event.track_source);
    if (event.type === 'participant.role_changed')
      set_role(event.room_member_role);
  },
});

input.addEventListener('input', () => signal.send_typing(true)); // throttled; stops itself after 3 s idle
input.addEventListener('blur', () => signal.send_typing(false));
await signal.send_reaction('🎉'); // returns false if invalid or rate limited

// On leave
signal.close();
```

---

## 10. Audit log

### `GET /audit`

Available to the host, and to members whose `access.actions` includes `audit.find`. Everyone else gets `403`.

| Query          | Type     | Notes                                                |
| -------------- | -------- | ---------------------------------------------------- |
| `room_uid`     | uuid     | required                                             |
| `page`         | number   | default `1`                                          |
| `take`         | number   | default `20`, max `100`                              |
| `audit_action` | string[] | filter, repeatable: `?audit_action=a&audit_action=b` |

```
GET /audit?room_uid=7d0f6c1e-...&take=50&audit_action=room_member.ban
```

```json
{
  "rows": 1,
  "pages": 1,
  "page": 1,
  "take": 50,
  "data": [
    {
      "audit_id": 12,
      "room_id": 1,
      "user_id": 1,
      "audit_action": "room_member.ban",
      "audit_target": "user_42",
      "audit_metadata": {
        "room_uid": "7d0f6c1e-...",
        "room_member_role": "member",
        "ban": true
      },
      "created_at": "2026-10-22T10:05:00.000Z"
    }
  ]
}
```

Results are sorted newest first. `user_id` is the actor (`null` for server enforcement). `audit_target` is `user_<id>`, or `room_<uid>` for room-level actions.

| Action                                            | Written by                             | Metadata                         |
| ------------------------------------------------- | -------------------------------------- | -------------------------------- |
| `room.update`                                     | `PATCH /room`                          | `previous`, `next`               |
| `lobby.admit` / `lobby.deny`                      | `PATCH /room-member` (status)          | `previous_status`, `next_status` |
| `room_member.role`                                | `PATCH /room-member` (role)            | `previous_role`, `next_role`     |
| `room_member.delete` / `room_member.ban`          | `DELETE /room-member`                  | `room_member_role`, `ban`        |
| `participant.mute` / `participant.unmute_request` | `POST /participant/mute`               | `track_source`, `track_sids`     |
| `participant.promote` / `participant.demote`      | `POST /participant/promote` / `demote` | `previous_role`, `next_role`     |
| `participant.remove`                              | `DELETE /participant`                  | `connected`, `block_minutes`     |
| `participant.enforce_remove`                      | LiveKit webhook (server)               | `participant_sid`                |

---

## 11. LiveKit webhook (server setup)

### `POST /webhook/livekit`

No bearer token. LiveKit signs the request with the API key and secret, and the backend verifies it. Point LiveKit at it in the LiveKit server config:

```yaml
webhook:
  api_key: <LIVEKIT_API_KEY>
  urls:
    - http://<backend-host>:3000/webhook/livekit
```

On `participant_joined`, the backend checks the participant again: membership, ban, block, room closed, declined status and lobby. Anyone who isn't allowed (for example someone reusing an old token after being banned) is disconnected and logged as `participant.enforce_remove`. It also fixes the participant's role if it doesn't match the database. Duplicate deliveries are ignored for 24 hours.

```json
// 200
{ "data": { "duplicate": false, "removed": true } }
```

---

## 12. Testing locally

A ready-made Postman collection covers every flow above:

```bash
cd apps/backend
bun run postman:seed   # creates host, moderator, member, viewer, guest, outsider and a room
bun run postman:dev    # starts the server with postman/.env.postman
```

Import `postman/mawiid.postman_collection.json` and `postman/mawiid.postman_environment.json`, select **Mawiid local**, and run the folders in order. Redis and LiveKit must be running.
