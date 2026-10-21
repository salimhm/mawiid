# Room Members and Lobby

Room members are stored in the room owner's vault (`room_member`). A member row decides who may join a room, with which role, and whether they wait in the lobby or are banned.

Every operation calls `service_room.authorize` first.

---

## 1. Roles and Status

### Enums (`@lib/enum.lib`)

- `enum_room_member_role`: `host`, `moderator`, `member`, `viewer`
- `enum_room_member_status`: `invited`, `waiting`, `active`, `declined`

### Capabilities

| Capability                               | host | moderator | member | viewer          |
| ---------------------------------------- | ---- | --------- | ------ | --------------- |
| Microphone and camera                    | Yes  | Yes       | Yes    | After promotion |
| Screen share                             | Yes  | Yes       | Yes    | No              |
| Chat                                     | Yes  | Yes       | Yes    | Room setting    |
| Invite people                            | Yes  | Yes       | No     | No              |
| Mute, remove, admit from the lobby       | Yes  | Yes       | No     | No              |
| Promote or demote speakers               | Yes  | Yes       | No     | No              |
| Lock, translation and recording settings | Yes  | Yes       | No     | No              |
| Close the live for everyone              | Yes  | Yes       | No     | No              |
| Change moderators                        | Yes  | No        | No     | No              |

The vault `access` table still gates actions outside a room, such as `room.create` and `audit.find`.

---

## 2. APIs

| Method   | Endpoint       | Function | Who             | Description                                                                         |
| -------- | -------------- | -------- | --------------- | ----------------------------------------------------------------------------------- |
| `GET`    | `/room-member` | `find`   | Member          | Members, roles and status                                                           |
| `POST`   | `/room-member` | `create` | Host, moderator | Invite users; users from other vaults also get a `room_guest` row in the main DB    |
| `PATCH`  | `/room-member` | `update` | Host, moderator | Change a role, or admit / deny from the lobby (`room_member_status`)                |
| `DELETE` | `/room-member` | `delete` | Host, moderator | Remove from the room (soft delete); `ban: true` sets `room_member_banned_at`        |

### Rules

- Invites are rate limited: 100 per hour per user (`rate:invite:<user_id>`).
- An invite sets `room_member_status = 'invited'` and sends `room.invited` over the WebSocket, or a push notification when the user is offline. A `direct` room sends `room.ring` instead (see `presence`).
- Only the host can make someone a moderator or remove the moderator role.
- A role change is saved in `room_member`, then copied to the participant's `mawiid.role` attribute and permissions with `updateParticipant` if they are connected.
- `(room_id, user_id)` is unique among non-deleted rows, so a removed member can be invited again unless banned.

---

## 3. Lobby

### Flow

1. A guest calls `POST /room/join` on a room with `room_lobby_enabled`. Their `room_member_status` is `waiting`, so the backend answers `403 room-waiting`.
2. Hosts and moderators receive `room.knock` (`room_uid`, `user_id`) over the WebSocket.
3. A host or moderator calls `PATCH /room-member` with `room_member_status: 'active'` (admit) or `'declined'` (deny).
4. On admit, the guest receives `room.admitted` (`room_uid`) and calls `POST /room/join` again.

### WebSocket Events

| Event           | To                | Data                  | When                       |
| --------------- | ----------------- | --------------------- | -------------------------- |
| `room.invited`  | Invitee           | `room_uid`, `room_title`, `invited_by` | An invite is created |
| `room.knock`    | Hosts, moderators | `room_uid`, `user_id` | Someone waits in the lobby |
| `room.admitted` | Guest             | `room_uid`            | A host admitted them       |

---

## 4. Ban

- `DELETE /room-member` with `ban: true` sets `room_member_banned_at`, then calls `removeParticipant` if the user is connected.
- `service_room.authorize` refuses banned members, so they never receive a new token.
- Self-hosted LiveKit does not revoke tokens: the `participant_joined` webhook removes a banned identity again as soon as it reconnects.
- Every removal and ban writes an `audit` row.

---

## 5. Acceptance Criteria

- Member roles can be changed successfully, and connected participants see the new `mawiid.role`.
- Only the host can change moderators.
- Members can be admitted from the lobby; a denied guest cannot join.
- A waiting guest gets `room-waiting` from `POST /room/join`.
- Hosts receive `room.knock`; admitted guests receive `room.admitted`.
- Banned members are refused access and cannot rejoin with an old token.
- Invites to users who are offline produce a push notification.
