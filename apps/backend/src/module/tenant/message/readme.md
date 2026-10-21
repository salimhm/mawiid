# Messaging System

The server owns chat. A client never sends a chat message straight to other clients: it calls `POST /message`, the backend saves it in the room owner's vault, then broadcasts it with LiveKit `sendData` through `lib_livekit_broadcast`.

---

## 1. Message APIs

| Method   | Endpoint   | Function | Who                   | Description                                                 |
| -------- | ---------- | -------- | --------------------- | ----------------------------------------------------------- |
| `GET`    | `/message` | `find`   | Member                | History with `before_message_id`, `after_message_id`, `take` |
| `POST`   | `/message` | `create` | Member                | Save and broadcast (idempotent on `message_client_id`)      |
| `PATCH`  | `/message` | `update` | Author, within 15 min | Edit the text, set `message_edited_at`                      |
| `DELETE` | `/message` | `delete` | Author, moderator     | Soft delete (`deleted_at`)                                  |

Every route calls `service_room.authorize` first. Viewers can send messages only when the room allows it.

### Create Message

Body: `room_uid`, `message_client_id` (UUID), `message_text`, `message_file_ids`, `message_reply_to_id`.

Limits:

- `message_text`: 3,000 characters maximum (fits LiveKit's 15 KiB reliable packet limit).
- `message_file_ids`: 10 files maximum, 10 MB per file.
- Rate limit: 20 messages per 10 s per user per room (`rate:message:<room_uid>:<user_id>`).

### Retrieve Message History

Query: `room_uid`, `take` (default 50), and one of:

- `before_message_id` — messages older than this one (scroll up).
- `after_message_id` — messages newer than this one (fill a gap after reconnecting).

Rules:

- Order by `message_id`, newest first. `message_id` is the server-generated, stable order.
- Return `lib_dto_find_response` (`rows`, `pages`, `page`, `take`, `data`).
- Hide soft-deleted messages, or return them as deleted placeholders.

### Update and Delete

- Only the author can edit, and only within 15 minutes of `created_at`.
- The author or a host or moderator can delete. Deletion is soft.
- Both are persisted first, then broadcast as `message.updated` and `message.deleted`.

---

## 2. Real-Time Message Broadcasting

### Server-Side Flow

When `POST /message` is called:

1. Check the JWT and call `service_room.authorize` (membership, ban).
2. Apply the rate limit.
3. Validate the payload (length, file count, files belong to this vault).
4. Upsert the message on `(room_id, user_id, message_client_id)`. A retry returns the existing row.
5. Broadcast the saved message with `lib_livekit_broadcast(room_uid, room_topic.message, event)`, reliable.
6. Send `message.created` over the WebSocket to members who are online but not in the live, for unread badges.
7. Return the saved message.

### Event Payload (`mawiid.message.v1`)

Defined as `room_event_message` in `packages/contracts/src/room.ts`:

| Field                 | Type                                                       |
| --------------------- | ---------------------------------------------------------- |
| `type`                | `message.created`, `message.updated` or `message.deleted`  |
| `room_uid`            | string                                                     |
| `message_id`          | number                                                     |
| `message_client_id`   | string                                                     |
| `user_id`             | number                                                     |
| `message_text`        | string, max 3,000                                          |
| `message_file_ids`    | string[]                                                   |
| `message_reply_to_id` | number or null                                             |
| `created_at`          | string                                                     |

### Event Validation

- Clients accept `mawiid.message.v1` packets **only when `participant` is `undefined`**. Packets sent by the server API have no sender; anything published by a client on this topic is dropped.
- Validate every payload with `Value.Check(room_event_message, event)` before using it.
- Render message text as plain text, never as HTML.

---

## 3. Attachments

1. Upload first with `POST /file` (pattern `example-file-service`, 10 MB max).
2. Send the returned `file_id` values in `message_file_ids`.
3. Downloads use short-lived signed URLs from `GET /file`.

---

## 4. Client-Side Implementation

### Optimistic Message Rendering

- Give each outgoing message a `message_client_id` (UUID) and show it as pending right away.
- When the broadcast or the HTTP response arrives with the same `message_client_id`, replace the pending message with the saved one.
- Whichever arrives first wins; the other is ignored, so the message is never rendered twice.
- Retry `POST /message` on network errors with the same `message_client_id`.

### Reconnection and Message Recovery

- Late joiners load history with `GET /message?room_uid=...&take=50`.
- After `RoomEvent.Reconnected`, call `GET /message?room_uid=...&after_message_id=<last seen>`.
- Merge by `message_id` and deduplicate messages received both from history and from real-time events.

---

## 5. Persistence and Reliability

### Message Storage

- Messages live in the room owner's vault `message` table, never in the main database.
- They stay available after refreshes, disconnections and reconnects, under the tenant's retention rules (proposed default: 1 year).
- Store `message_id`, `room_id`, `user_id`, `message_client_id`, `message_text`, `message_file_ids`, `message_reply_to_id`, `message_edited_at`, `created_at`, `deleted_at`.

### Idempotency

- Unique index on `(room_id, user_id, message_client_id)`.
- Concurrent retries are safe at the database level: the upsert returns the existing row instead of creating another.

### Consistency

- Persist before broadcasting.
- Sender and receivers reconcile against the same server-generated `message_id`.
- History and real-time delivery together never lose or duplicate a message.

### Confidential Rooms

When `room_encrypted` is true, server-side chat history is off: the server cannot read what it cannot decrypt.

---

## 6. Acceptance Criteria

- Messages sent in one browser tab appear in the other tab in real time.
- Messages are persisted in the room owner's vault and remain available after reconnecting.
- Messages appear immediately in the sender's UI through optimistic rendering.
- The server-confirmed message replaces the optimistic version using `message_client_id`.
- Retrying a message request never creates duplicate messages.
- Clients accept `mawiid.message.v1` only when `participant` is `undefined`.
- After a `Reconnected` event, missed messages are fetched with `after_message_id` and displayed.
- Message history supports `before_message_id`, `after_message_id` and `take`.
- Edits within 15 minutes and deletions are persisted and reflected across connected clients.
- Messages over 3,000 characters and senders over the rate limit are refused.
- Members online but not in the live receive `message.created` for unread badges.
