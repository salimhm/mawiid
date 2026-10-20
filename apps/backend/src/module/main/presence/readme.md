# Presence and Direct Calls

## 1. APIs

### Presence Ticket

| Method | Endpoint           | Description                |
| ------ | ------------------ | -------------------------- |
| `POST` | `/presence/ticket` | Generate a presence ticket |

### WebSocket

| Protocol | Endpoint       | Description                            |
| -------- | -------------- | -------------------------------------- |
| `WS`     | `/presence/ws` | Handle presence connections and events |

WebSocket lifecycle:

- `open` — establish a connection.
- `message` — receive and process messages.
- `close` — handle disconnection and cleanup.

### Presence Management

| Method  | Endpoint    | Description                 |
| ------- | ----------- | --------------------------- |
| `GET`   | `/presence` | Find presence information   |
| `PATCH` | `/presence` | Update presence information |

### Direct Call

| Method | Endpoint        | Description              |
| ------ | --------------- | ------------------------ |
| `POST` | `/room/decline` | Decline an incoming call |

---

## 2. Events

Implement and handle the following events:

| Event                | Description                                         |
| -------------------- | --------------------------------------------------- |
| `presence.updated`   | Notify clients when a user's presence changes       |
| `room.invited`       | Notify a user that they have been invited to a room |
| `room.ring`          | Notify the recipient of an incoming direct call     |
| `room.ring_canceled` | Notify the recipient that a call has been canceled  |
| `room.declined`      | Notify the caller that the call was declined        |
| `room.missed`        | Notify the caller that the call was not answered    |
| `room.closed`        | Notify participants that the room has been closed   |

---

## 3. Direct Call Lifecycle

1. The caller initiates a direct call.
2. The recipient receives the `room.ring` event.
3. The recipient can either:
   - **Accept** the call and join the room.
   - **Decline** the call through `POST /room/decline`.
4. If the call is declined, emit `room.declined` and handle any necessary cleanup.
5. If the call is canceled, emit `room.ring_canceled`.
6. If the recipient does not answer within **45 seconds**, mark the call as missed and emit `room.missed`.
7. When the room closes, emit `room.closed`.

---

## 4. Acceptance Criteria

- User 1 appears online to user 2.
- Presence changes are propagated through WebSocket events.
- A direct call initiated by user 1 causes user 2's client to ring.
- User 2 can accept the call and join the room.
- User 2 can decline the call, notifying user 1.
- If user 2 does not answer within 45 seconds, the call is marked as missed.
- Call cancellation and room closure are propagated to the relevant participants.
