# Messaging System

## 1. Message APIs

### Create Message

| Method | Endpoint   | Description                                                                     |
| ------ | ---------- | ------------------------------------------------------------------------------- |
| `POST` | `/message` | Create and persist a message, then broadcast it through `lib_livekit_broadcast` |

Requirements:

- Validate the sender's identity and room permissions.
- Save the message to persistent storage before broadcasting it.
- Use `message_client_id` to support idempotency and prevent duplicate messages on retries.

### Retrieve Message History

| Method | Endpoint   | Description              |
| ------ | ---------- | ------------------------ |
| `GET`  | `/message` | Retrieve message history |

Support the following query parameters:

- `before_message_id` — retrieve messages preceding a specified message.
- `after_message_id` — retrieve messages following a specified message.

Requirements:

- Enforce room membership and message access permissions.
- Support pagination for large message histories.
- Return messages in a consistent order.

### Update Message

| Method  | Endpoint   | Description                |
| ------- | ---------- | -------------------------- |
| `PATCH` | `/message` | Update an existing message |

Requirements:

- Verify that the requester has permission to edit the message.
- Persist the update and synchronize the change with connected clients.

### Delete Message

| Method   | Endpoint   | Description                |
| -------- | ---------- | -------------------------- |
| `DELETE` | `/message` | Delete an existing message |

Requirements:

- Verify that the requester has permission to delete the message.
- Persist the deletion and synchronize it with connected clients.

---

## 2. Real-Time Message Broadcasting

### Server-Side Flow

When `POST /message` is called:

1. Authenticate the sender and authorize access to the room.
2. Validate the message payload.
3. Check `message_client_id` for an existing message to prevent duplicates.
4. Save the message to persistent storage.
5. Broadcast the persisted message using `lib_livekit_broadcast`.
6. Return the saved message to the client.

### Event Validation

- Accept `mawiid.message.v1` events only when they originate from the trusted server.
- Do not trust client-published events that impersonate server messages.
- Validate the event payload before processing it.

---

## 3. Client-Side Implementation

### Optimistic Message Rendering

- Display sent messages immediately without waiting for the server response.
- Assign each outgoing message a unique `message_client_id`.
- Match the server-confirmed message with the optimistic message using `message_client_id`.
- Replace or reconcile the optimistic message with the persisted server version.
- Prevent duplicate rendering when a request is retried or a broadcast arrives before the HTTP response.

### Reconnection and Message Recovery

- Detect when the LiveKit connection is re-established.
- After the `Reconnected` event, refetch messages missed during disconnection.
- Use `after_message_id` to retrieve messages newer than the last known message.
- Merge fetched messages with local state using stable message identifiers.
- Deduplicate messages received through both history requests and real-time events.

---

## 4. Persistence and Reliability

### Message Storage

- Persist messages in the application's database or designated vault.
- Ensure messages remain available after page refreshes, disconnections, and reconnects.
- Preserve message identity, sender, room, content, and timestamps.

### Idempotency

- Enforce uniqueness for `message_client_id` within the appropriate sender or room scope.
- Handle concurrent retries safely at the database level.
- Return the existing persisted message when a duplicate request is received, rather than creating another row.

### Consistency

- Persist messages before broadcasting them.
- Ensure the sender and other participants reconcile messages against the same server-generated message ID.
- Make history retrieval and real-time delivery work together without losing or duplicating messages.

---

## 5. Acceptance Criteria

- Messages sent in one browser tab appear in the other tab in real time.
- Messages are persisted in the designated vault and remain available after reconnecting.
- Messages appear immediately in the sender's UI through optimistic rendering.
- The server-confirmed message replaces the optimistic version using `message_client_id`.
- Retrying a message request never creates duplicate messages.
- Clients accept `mawiid.message.v1` only from the trusted server.
- After a `Reconnected` event, missed messages are fetched and displayed.
- Message history supports both `before_message_id` and `after_message_id`.
- Message edits and deletions are persisted and reflected across connected clients.
