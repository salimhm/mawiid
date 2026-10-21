# Participant Moderation and Live Signals

A participant is a person connected to a live right now. LiveKit is authoritative for who is connected; the backend mirrors it in `room:<room_uid>:live` and keeps attendance in the vault `participant` table, both updated by the `participant_joined` and `participant_left` webhooks.

Room lock and lobby settings live in the `room` and `room-member` modules.

---

## 1. Participant APIs

| Method   | Endpoint               | Function  | Who             | Description                                                    |
| -------- | ---------------------- | --------- | --------------- | -------------------------------------------------------------- |
| `GET`    | `/participant`         | `find`    | Member          | Who is in the live now, plus attendance history                |
| `PATCH`  | `/participant`         | `update`  | Self            | My caption language, my raised hand                            |
| `POST`   | `/participant/mute`    | `mute`    | Host, moderator | Mute a track, or ask someone to unmute                         |
| `POST`   | `/participant/promote` | `promote` | Host, moderator | Viewer → speaker (`member`, can publish)                       |
| `POST`   | `/participant/demote`  | `demote`  | Host, moderator | Speaker → `viewer`                                             |
| `DELETE` | `/participant`         | `delete`  | Host, moderator | Disconnect someone now                                         |

Ban (block rejoining) is `DELETE /room-member` with `ban: true`.

### Authorization

- Call `service_room.authorize`, then check the actor's role before any LiveKit call.
- Only hosts and moderators can moderate. Nobody can moderate a host except another host.
- Never trust identities or roles sent by the client; read them from the JWT and the vault.

---

## 2. Moderation Actions

| Action          | Endpoint                                     | LiveKit call                                                          | What people see                                      |
| --------------- | -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| Mute a track    | `POST /participant/mute`                     | Find the track by source with `getParticipant`, then `mutePublishedTrack(room_uid, identity, track_sid, true)` | `TrackMuted`; a notice on `mawiid.moderation.v1` |
| Ask to unmute   | `POST /participant/mute` with `muted: false` | `sendData` to that identity on `mawiid.moderation.v1`                 | "The host asks you to unmute"                        |
| Remove          | `DELETE /participant`                        | `removeParticipant(room_uid, identity)`                               | `Disconnected(PARTICIPANT_REMOVED)`                  |
| Promote         | `POST /participant/promote`                  | `updateParticipant` with publish permission and `mawiid.role=member`  | `ParticipantPermissionsChanged`; can publish         |
| Demote          | `POST /participant/demote`                   | `updateParticipant` without publish permission, `mawiid.role=viewer`  | Their tracks stop                                    |

- Remote unmute stays off by default for privacy: the server only sends a request.
- Role changes are saved in `room_member` first, then copied to LiveKit.
- Moderation notices use `lib_livekit_broadcast` on `mawiid.moderation.v1` to one identity. Clients accept them only when `participant` is `undefined` (sent by the server).

---

## 3. Participant Attributes

Only the server sets attributes, because tokens use `canUpdateOwnMetadata: false`.

| Attribute            | Example       | Set by                      | Changes through                       |
| -------------------- | ------------- | --------------------------- | ------------------------------------- |
| `mawiid.user_id`     | `"42"`        | Token                       | Never                                 |
| `mawiid.role`        | `"moderator"` | Token                       | Promote, demote, `PATCH /room-member` |
| `mawiid.language`    | `"fr"`        | Token, from `user_language` | `PATCH /participant`                  |
| `mawiid.hand_raised` | `"true"`      | Backend                     | `PATCH /participant`                  |

Clients read them from participant attributes and `ParticipantAttributesChanged`. Late joiners see raised hands because they are attributes, not events.

---

## 4. Client-Side Live Signals

| Signal    | Transport                                                        | Saved | Accepted from   |
| --------- | ---------------------------------------------------------------- | ----- | --------------- |
| Typing    | `publishData`, lossy, topic `mawiid.typing.v1`, at most every 3 s | No    | Any participant |
| Reactions | `publishData`, reliable, topic `mawiid.reaction.v1`              | No    | Any participant |

- Throttle typing to at most one event every 3 seconds.
- Reactions are transient events, not room state.
- Topic names come from `room_topic` in `packages/contracts`.
- Validate every incoming payload against the contracts and drop unknown or oversized ones.

---

## 5. Moderation Audit Log

Write an `audit` row in the vault for every moderation action (mute, unmute request, remove, ban, promote, demote, role change, lobby admit or deny, room close).

Map the fields onto the `Audit` model:

| Need                  | Column           | Value                                                    |
| --------------------- | ---------------- | -------------------------------------------------------- |
| Actor                 | `user_id`        | From the JWT payload, never from the request body        |
| Action                | `audit_action`   | `participant.mute`, `participant.remove`, `participant.promote`, ... |
| Target                | `audit_target`   | `user_<user_id>` of the affected participant             |
| Room and details      | `audit_metadata` | `room_uid`, previous and new role, track source, `ban`   |
| Timestamp             | `created_at`     | Set by the database                                      |

### Requirements

- Check authorization before running the action.
- Write the audit row only after the action succeeds.
- `GET /audit` is restricted to admins with `audit.find` access.
- Clients can never write audit rows or choose the actor.

---

## 6. Reconnection and Ban Enforcement

Self-hosted LiveKit does not revoke a token after removal or a permission change, and connected clients receive refreshed tokens valid for about 10 minutes. Three layers close the gap:

1. A 5-minute token TTL.
2. `service_room.authorize` refuses banned members, so no new token is issued.
3. The `participant_joined` webhook (`service_participant.join`) calls `removeParticipant` at once when the member is banned.

`service_participant.join` also ignores agent identities, adds the user to `room:<room_uid>:live`, sets presence to `busy` and opens a `participant` row. `service_participant.leave` closes the row, removes the user from `room:<room_uid>:live` and sets presence back to `online`.

---

## 7. Acceptance Criteria

- The host can mute participants, and can ask them to unmute without unmuting them.
- The host can remove participants immediately.
- The host can promote and demote participants; permissions change in LiveKit.
- A member or viewer cannot moderate anyone.
- Every moderation action generates an audit record with the actor from the JWT.
- A removed or banned participant cannot rejoin, even with an unexpired token.
- Raised hand and caption language update the participant attributes.
- Typing indicators and reactions are broadcast to other participants through LiveKit `publishData`.
