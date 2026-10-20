# Participant Moderation, Room Controls, and Lobby

## 1. Participant APIs

### Moderation Actions

| Method   | Endpoint               | Description                                                          |
| -------- | ---------------------- | -------------------------------------------------------------------- |
| `POST`   | `/participant/mute`    | Mute a participant                                                   |
| `POST`   | `/participant/promote` | Promote a participant to a higher role                               |
| `POST`   | `/participant/demote`  | Demote a participant to a lower role                                 |
| `DELETE` | `/participant`         | Immediately disconnect a participant                                 |
| `PATCH`  | `/participant`         | Update participant settings, such as raised hand or caption language |

### Authorization

- Only authorized users, such as the room host or moderators, can perform moderation actions.
- Validate the actor's role and permissions before applying any action.
- Prevent unauthorized participants from modifying other participants.

---

## 2. Room Lock and Lobby

### Room Controls

| Method  | Endpoint | Description                                              |
| ------- | -------- | -------------------------------------------------------- |
| `PATCH` | `/room`  | Update room settings, including room lock and lobby mode |

Support the following room settings:

- **Room lock:** Prevent unauthorized participants from joining.
- **Lobby:** Require guests to wait for approval before entering the room.

### Lobby Admission

| Method  | Endpoint       | Description                        |
| ------- | -------------- | ---------------------------------- |
| `PATCH` | `/room-member` | Admit a participant from the lobby |

### WebSocket Events

| Event           | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| `room.knock`    | Notify the host or moderators that a guest is requesting entry |
| `room.admitted` | Notify a guest that they have been admitted                    |

### Lobby Flow

1. A guest attempts to join a room with the lobby enabled.
2. The guest waits for approval.
3. The host receives the `room.knock` event.
4. The host admits the guest through `PATCH /room-member`.
5. The guest receives the `room.admitted` event and can enter the room.

---

## 3. Client-Side Features

### Typing Indicator

- Implement a typing indicator for participants.
- Use LiveKit `publishData` to broadcast typing status to other participants.
- Handle incoming data messages and update the UI accordingly.
- Avoid excessive event publishing by throttling or debouncing updates.

### Reactions

- Allow participants to send reactions, such as emojis.
- Use LiveKit `publishData` to broadcast reactions to other participants.
- Display received reactions in the client UI.
- Treat reactions as transient events rather than persistent room state.

---

## 4. Moderation Audit Log

Write an audit row for every moderation action.

Record the following information where applicable:

- **Room ID:** The room in which the action occurred.
- **Actor ID:** The user who performed the action.
- **Target participant ID:** The affected participant.
- **Action:** Mute, promote, demote, disconnect, or another moderation action.
- **Timestamp:** When the action occurred.
- **Metadata:** Relevant details, such as previous and new roles or mute status.

### Requirements

- Persist audit records in the database.
- Validate authorization before executing moderation actions.
- Record successful moderation actions reliably.
- Restrict audit-log access to authorized users.
- Never allow clients to forge audit records or actor identities.

---

## 5. Reconnection and Ban Enforcement

- A participant removed from a room must not be able to rejoin while the removal restriction remains active.
- Enforce removal or ban restrictions on the server, not only in the client.
- Check membership and ban status before issuing a new join token.
- Disconnect unauthorized participants who attempt to bypass room restrictions.

---

## 6. Acceptance Criteria

- The host can mute participants.
- The host can remove participants immediately.
- The host can promote and demote participants.
- Every moderation action generates an audit record.
- A removed or banned participant cannot rejoin in violation of the applicable restriction.
- The host can lock and unlock the room.
- When the lobby is enabled, guests must wait for approval.
- The host receives `room.knock` when a guest requests entry.
- The host can admit a guest, who receives `room.admitted` and can enter the room.
- Typing indicators and reactions are broadcast to other participants through LiveKit `publishData`.
