# Room Management

## 1. Room CRUD

### APIs

| Method   | Endpoint | Description   |
| -------- | -------- | ------------- |
| `POST`   | `/room`  | Create a room |
| `GET`    | `/room`  | Find rooms    |
| `PATCH`  | `/room`  | Update a room |
| `DELETE` | `/room`  | Delete a room |

### Authorization

- Implement `service_room.authorize`.
- Ensure every subsequent room-related operation uses this authorization service.

### Acceptance Criteria

- User 1 can create a room and add users 2 and 3.
- User 4, who is not authorized to access the room, is refused access.

---

## 2. Room Members

### APIs

| Method   | Endpoint       | Description                                         |
| -------- | -------------- | --------------------------------------------------- |
| `GET`    | `/room-member` | Find room members                                   |
| `POST`   | `/room-member` | Invite a member                                     |
| `PATCH`  | `/room-member` | Update a member's role or admit them from the lobby |
| `DELETE` | `/room-member` | Remove a member, optionally banning them            |

### Acceptance Criteria

- Member roles can be changed successfully.
- Members can be admitted from the lobby.
- Banned members are refused access.

---

## 3. Join, Leave, and Close — The First Real Call

### APIs

| Method | Endpoint      | Description  |
| ------ | ------------- | ------------ |
| `POST` | `/room/join`  | Join a room  |
| `POST` | `/room/leave` | Leave a room |
| `POST` | `/room/close` | Close a room |

### Join Flow

The `POST /room/join` endpoint must:

1. Run all required authorization and membership checks.
2. Acquire a Redis lock to prevent concurrent room initialization.
3. Create or ensure the LiveKit room exists using `lib_livekit_ensure`.
4. Generate and return a LiveKit token valid for **5 minutes**.

### Leave Flow

- Allow an authorized participant to leave the room.
- Handle the participant's departure and associated cleanup as needed.

### Close Flow

1. Call LiveKit's `deleteRoom`.
2. Call `finish` to complete the room's shutdown and cleanup process.
3. Ensure connected participants are disconnected.

### Client Implementation

- Implement `create_room_session` in `packages/room-client`.
- Build a small browser-based test page.
- Allow users to select from seeded test users.

### Acceptance Criteria

- Two browser tabs can join the same room.
- Both participants can hear and see each other.
- Closing the room disconnects both participants.
