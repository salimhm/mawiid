# LiveKit Webhooks and Reconciliation

LiveKit reports room and participant events by webhook. Webhooks are push-only: LiveKit retries a few times, then gives up, and events can arrive twice, late or out of order. Every handler must be idempotent, and a reconciliation loop repairs anything lost.

---

## 1. API

| Method | Endpoint           | Function  | Who               | Description                 |
| ------ | ------------------ | --------- | ----------------- | --------------------------- |
| `POST` | `/webhook/livekit` | `livekit` | LiveKit signature | Room and participant events |

### Verification

- LiveKit signs each webhook with a JWT in the `Authorization` header containing a SHA-256 hash of the body.
- The check needs the **raw** body; LiveKit sends `Content-Type: application/webhook+json`, so the route uses `{ parse: 'text' }`.
- Verify with `lib_livekit_webhook.receive(body, authorization)`; on failure throw `invalid_token`.

### De-duplication

- `SET webhook:<event_id> 1 EX 86400 NX`. If the key exists, return `{ duplicate: true }`.
- If the handler fails, delete the key so LiveKit's retry runs it again.

---

## 2. Events

| Event                            | Handler                           | Effect                                                                                                       |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `room_started`                   | `service_room.start`              | `room_status = 'live'`, `room_started_at`, add to `rooms:live`, send `room.started`                          |
| `room_finished`                  | `service_room.finish(_, 'empty')` | Close the room (first reason wins)                                                                           |
| `participant_joined`             | `service_participant.join`        | Ignore agents; open a `participant` row; add to `room:<room_uid>:live`; set `busy`; remove at once if banned |
| `participant_left`               | `service_participant.leave`       | Close the row; remove from `room:<room_uid>:live`; set `online`; in a `direct` room close it for both        |
| `participant_connection_aborted` | `service_participant.leave`       | Same as `participant_left`                                                                                   |
| `track_published`                | Later                             | Only when recording or AI features need it                                                                   |

Accept events in any order: a `room_finished` that arrives before `participant_left` must still close everything.

---

## 3. Reconciliation

Every 60 seconds, one instance holding `lock:reconcile` (55 s) compares `rooms:live` with LiveKit:

- A room in `rooms:live` but missing from `listRooms` → `finish(room_uid, 'empty')`.
- A LiveKit room that is unknown or `closed` in the vault → `deleteRoom`.
- Open `participant` rows that are not in `listParticipants` → close them.

Each fix is a bug or a lost webhook; the target is close to zero per day.

---

## 4. Acceptance Criteria

- A webhook with a bad signature is refused.
- A replayed webhook is processed only once.
- A failed handler runs again on LiveKit's retry.
- Out-of-order events still leave the room and participants in the right state.
- A banned identity that reconnects is removed again by `participant_joined`.
- A lost `room_finished` is repaired by reconciliation within 60 seconds.
