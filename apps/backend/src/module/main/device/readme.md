# Devices and Push Notifications

Calls and invites must reach users whose app is closed. The `device` module stores push tokens in the main database so the backend can send push notifications and VoIP pushes.

---

## 1. APIs

| Method   | Endpoint  | Function | Who  | Description                             |
| -------- | --------- | -------- | ---- | --------------------------------------- |
| `POST`   | `/device` | `create` | User | Register a push token (FCM, APNs, VoIP) |
| `DELETE` | `/device` | `delete` | User | Remove it on logout (soft delete)       |

## 2. Data

`device` table (main database): `device_id`, `user_id`, `device_platform`, `device_push_token`, `device_voip_token`, `created_at`, `deleted_at`. `device_push_token` is unique among non-deleted rows.

## 3. Usage

- `room.ring` → VoIP push to every device of the callee (CallKit on iOS, full-screen call notification on Android).
- `room.invited` → push notification when the invitee is offline.
- `room.ring_canceled` → cancel the ringing on the other devices.
- `DELETE /auth` (logout) also removes the device.

## 4. Acceptance Criteria

- A registered device rings for a direct call when the app is closed.
- An offline invitee receives a push notification.
- A logged-out device no longer receives pushes.
