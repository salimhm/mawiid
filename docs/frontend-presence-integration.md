# Frontend Integration: Presence

_Last updated: 2026-10-21 · Backend module: `apps/backend/src/module/main/presence/`_

This document is the full contract for integrating presence (online status and real-time events) into the Mawiid frontend: desktop (Tauri + React) and mobile (React Native). It is self-contained: you can give it to an AI coding agent as the only source.

## 1. What presence does

- Shows whether a user is `online`, `away`, `busy` or `offline`.
- Keeps one WebSocket open while the app runs. The backend uses it to push real-time events: status changes now, and later room events (incoming call `room.ring`, invites, room closed).
- `busy` is set automatically by the backend while the user is in a live (meeting). The frontend never sets "in a meeting" itself.

## 2. Environment

| Setting              | Dev value                            | Production value       |
| -------------------- | ------------------------------------ | ---------------------- |
| API base URL         | `http://localhost:3000`              | `https://<api-domain>` |
| WebSocket base URL   | `ws://localhost:3000`                | `wss://<api-domain>`   |
| Interactive API docs | `http://localhost:3000/openapi`      | Off                    |
| OpenAPI spec         | `http://localhost:3000/openapi/json` | Off                    |

Keep both URLs in configuration (for example `VITE_API_URL` and `VITE_SOCKET_URL`). Never hardcode them.

## 3. Authentication (temporary)

Real login is not built yet. Every HTTP request identifies the user with a dev header:

```http
x-user-id: 1
```

- The backend accepts it only when it runs with `ENV=dev`.
- Put header creation in **one function** (`headers()`), because it will become `authorization: Bearer <token>` later. Nothing else in the frontend should know about this header.
- The WebSocket does not use headers. It uses a ticket (section 5.1).

## 4. HTTP endpoints

All responses are JSON. Successful responses are wrapped in `{ "data": ... }`. Errors are `{ "code": "<error-code>" }` with the matching HTTP status.

### 4.1 `POST /presence/ticket`

Creates a one-time ticket for opening the WebSocket.

- Headers: `x-user-id`.
- Body: none.
- `200`:

```json
{ "data": { "ticket": "kZ0r2v...base64url", "expires_in": 30 } }
```

- The ticket works **once** and expires after **30 seconds**. Request a new ticket for every connection and every reconnection.
- Limit: 10 per minute per user, then `429`.

### 4.2 `GET /presence`

Returns the status of a list of users.

- Headers: `x-user-id`.
- Query: repeat `user_id`, from 1 to 200 values: `/presence?user_id=1&user_id=2&user_id=7`.
- `200`:

```json
{
  "data": [
    {
      "user_id": 1,
      "presence_status": "online",
      "presence_updated_at": "2026-10-21T09:12:44.120Z"
    },
    { "user_id": 2, "presence_status": "offline", "presence_updated_at": null }
  ]
}
```

- Users the caller is not allowed to see (not in the same organization) are **left out** of `data`. Treat a missing user as `offline` in the UI.
- `presence_updated_at` is `null` whenever the user shows as `offline`.

### 4.3 `PATCH /presence`

Sets the current user's chosen status. Use it when the WebSocket is not open; otherwise prefer the socket message (section 5.3).

- Headers: `x-user-id`, `content-type: application/json`.
- Body:

```json
{ "presence_status": "away" }
```

- `200`: `{ "data": { "user_id": 1, "presence_status": "away", "presence_updated_at": "..." } }`
- The response shows `offline` if the user has no open WebSocket. That is expected: status is only visible while connected.
- Limit: 30 status changes per minute per user (socket and HTTP together), then `429`.

### 4.4 Errors

| Status | Body                                                                      | When                                                             | What the frontend does            |
| ------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| `401`  | `{ "code": "unauthorized" }`                                              | Missing or invalid `x-user-id` (later: missing or expired token) | Send the user to login            |
| `422`  | Elysia validation object (`type: "validation"`, `property`, `message`, …) | Bad query or body                                                | Bug in the request; log it        |
| `429`  | `{ "code": "too-many-requests" }`                                         | Rate limit reached                                               | Wait and retry later; do not loop |
| `500`  | `{ "code": "internal-server-error" }`                                     | Server error                                                     | Retry with backoff                |

## 5. WebSocket

### 5.1 Connecting

1. Call `POST /presence/ticket`.
2. Open `new WebSocket(`${socket_url}/presence/ws?ticket=${encodeURIComponent(ticket)}`)` immediately.
3. A missing, expired or already used ticket makes the connection fail before it opens. The browser fires `error`, then `close` (usually code `1002`). Handle it like any other close: get a **new** ticket and reconnect.

The socket path is `/presence/ws`. It is not listed in the OpenAPI spec, because OpenAPI cannot describe WebSockets.

### 5.2 Heartbeat

Send this every **20 seconds** while the socket is open:

```json
{ "type": "presence.ping" }
```

- If the backend gets no ping for 45 seconds, the user becomes `offline` for everyone.
- The server does not reply to pings.

### 5.3 Changing my status

```json
{ "type": "presence.status", "data": { "presence_status": "away" } }
```

| Value     | Meaning                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| `online`  | Default. Clears any previous choice                                             |
| `away`    | Shown as away                                                                   |
| `busy`    | Shown as busy (manual "do not disturb")                                         |
| `offline` | Appear offline: others see `offline` even while connected and even in a meeting |

- The choice is remembered by the backend and survives reconnects and app restarts, until the user picks another value.
- Any other message shape is rejected: the server sends back a validation object (it has `"type": "validation"` and no `version`). Ignore it in production, log it in dev.

### 5.4 Events from the server

Every event uses the same envelope:

```json
{
  "type": "presence.updated",
  "version": 1,
  "data": {
    "user_id": 2,
    "presence_status": "online",
    "presence_updated_at": "2026-10-21T09:12:44.120Z"
  },
  "sent_at": "2026-10-21T09:12:44.125Z"
}
```

Rules:

- Only treat a message as an event if it has a string `type` and a numeric `version`.
- Route by `type`. Ignore unknown types without crashing: new types will be added.
- Handlers must be **idempotent**. The same event can arrive twice (for example, your own `presence.updated` comes through both your user channel and your organization channel).

Event types:

| Type                 | Sent now?           | `data`                                                    | Frontend action                        |
| -------------------- | ------------------- | --------------------------------------------------------- | -------------------------------------- |
| `presence.updated`   | Yes                 | `{ user_id, presence_status, presence_updated_at }`       | Update that user in the presence store |
| `room.ring`          | Planned (room team) | `{ room_uid, caller: { user_id }, busy }`                 | Show the incoming call screen          |
| `room.ring_canceled` | Planned             | `{ room_uid, reason }` (`answered`, `canceled`, `missed`) | Close the incoming call screen         |
| `room.declined`      | Planned             | `{ room_uid, user_id }`                                   | Tell the caller the call was declined  |
| `room.missed`        | Planned             | `{ room_uid }`                                            | Tell the caller nobody answered        |
| `room.invited`       | Planned             | `{ room_uid, room_title, invited_by }`                    | Show an invite notification            |
| `room.knock`         | Planned             | `{ room_uid, user_id }`                                   | Host: someone waits in the lobby       |
| `room.admitted`      | Planned             | `{ room_uid }`                                            | Guest: join the room now               |
| `room.started`       | Planned             | `{ room_uid }`                                            | Mark the meeting as live               |
| `room.closed`        | Planned             | `{ room_uid, room_close_reason }`                         | Close or mark the meeting as ended     |
| `message.created`    | Planned             | `{ room_uid, message_id, ... }`                           | Unread badge                           |
| `summary.created`    | Planned             | `{ room_uid }`                                            | "Recap ready" notification             |

Build the event router now so planned events only need a new handler.

### 5.5 Reconnecting

- On any `close` (network loss, server restart, Cloud Run's 60-minute limit), reconnect with a new ticket.
- Backoff: 1 s, 2 s, 4 s, … up to 30 s. Reset to 1 s after a successful `open`.
- After a **re**connection, call `GET /presence` again for the users on screen: you may have missed events while disconnected.
- Stop reconnecting only on logout or when the app shuts down.
- One socket per app instance. Never open a second socket for the same user in the same app.

## 6. Status rules (how the backend computes what others see)

| Situation                          | Others see                                              |
| ---------------------------------- | ------------------------------------------------------- |
| No open socket or no ping for 45 s | `offline`                                               |
| The user chose `offline`           | `offline`                                               |
| The user is in a meeting           | `busy`                                                  |
| Otherwise                          | The user's choice: `online` (default), `away` or `busy` |

- Several devices: a user with the desktop and the phone open stays online until **both** close.
- Visibility: users only see the status of people in the same organization.

## 7. Reference implementation

Put the client in a shared package used by desktop and mobile: `packages/presence-client`. Follow the repo rules: kebab-case files, snake_case variables and functions, two-space indent, no code comments.

### 7.1 `packages/presence-client/src/presence-client.ts`

```typescript
export type type_presence_status = 'online' | 'away' | 'busy' | 'offline';

export type type_presence = {
  user_id: number;
  presence_status: type_presence_status;
  presence_updated_at: string | null;
};

export type type_presence_event = {
  type: string;
  version: number;
  data: unknown;
  sent_at: string;
};

export type type_presence_client_options = {
  api_url: string;
  socket_url: string;
  headers: () => Record<string, string>;
  on_event: (event: type_presence_event) => void;
  on_reconnected: () => void;
};

export function create_presence_client(options: type_presence_client_options) {
  let socket: WebSocket | null = null;
  let ping_timer: ReturnType<typeof setInterval> | null = null;
  let retry_timer: ReturnType<typeof setTimeout> | null = null;
  let retry_delay = 1000;
  let stopped = true;
  let connected_once = false;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${options.api_url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...options.headers() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw await response.json().catch(() => ({ code: 'network-error' }));
    return (await response.json()) as T;
  }

  function send(message: unknown) {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  }

  function clear_ping() {
    if (ping_timer) clearInterval(ping_timer);
    ping_timer = null;
  }

  function schedule_reconnect() {
    if (stopped) return;
    retry_timer = setTimeout(() => void connect(), retry_delay);
    retry_delay = Math.min(retry_delay * 2, 30000);
  }

  function is_event(value: unknown): value is type_presence_event {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as type_presence_event).type === 'string' &&
      typeof (value as type_presence_event).version === 'number'
    );
  }

  async function connect() {
    if (stopped) return;
    let ticket: string;
    try {
      const { data } = await request<{ data: { ticket: string } }>(
        'POST',
        '/presence/ticket',
      );
      ticket = data.ticket;
    } catch {
      schedule_reconnect();
      return;
    }
    if (stopped) return;
    const current = new WebSocket(
      `${options.socket_url}/presence/ws?ticket=${encodeURIComponent(ticket)}`,
    );
    socket = current;
    current.onopen = () => {
      retry_delay = 1000;
      clear_ping();
      ping_timer = setInterval(() => send({ type: 'presence.ping' }), 20000);
      if (connected_once) options.on_reconnected();
      connected_once = true;
    };
    current.onmessage = (message) => {
      try {
        const value: unknown = JSON.parse(String(message.data));
        if (is_event(value)) options.on_event(value);
      } catch {
        return;
      }
    };
    current.onclose = () => {
      if (socket !== current) return;
      clear_ping();
      socket = null;
      schedule_reconnect();
    };
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void connect();
    },
    stop() {
      stopped = true;
      if (retry_timer) clearTimeout(retry_timer);
      clear_ping();
      const current = socket;
      socket = null;
      current?.close();
    },
    set_status(presence_status: type_presence_status) {
      if (socket?.readyState === WebSocket.OPEN) {
        send({ type: 'presence.status', data: { presence_status } });
        return Promise.resolve();
      }
      return request('PATCH', '/presence', { presence_status });
    },
    async find(user_ids: number[]): Promise<type_presence[]> {
      const unique = [...new Set(user_ids)].slice(0, 200);
      if (unique.length === 0) return [];
      const query = unique.map((user_id) => `user_id=${user_id}`).join('&');
      const { data } = await request<{ data: type_presence[] }>(
        'GET',
        `/presence?${query}`,
      );
      return data;
    },
  };
}
```

`find` asks for at most 200 users. For more, call it in chunks of 200.

### 7.2 React provider and hooks

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  create_presence_client,
  type type_presence,
  type type_presence_event,
} from '@mawiid/presence-client';

type type_presence_context = {
  statuses: Record<number, type_presence>;
  client: ReturnType<typeof create_presence_client> | null;
};

const presence_context = createContext<type_presence_context>({
  statuses: {},
  client: null,
});

export function PresenceProvider({
  user_id,
  watched_user_ids,
  on_event,
  children,
}: {
  user_id: number;
  watched_user_ids: number[];
  on_event: (event: type_presence_event) => void;
  children: ReactNode;
}) {
  const [statuses, set_statuses] = useState<Record<number, type_presence>>({});
  const watched = useRef(watched_user_ids);
  const handler = useRef(on_event);
  watched.current = watched_user_ids;
  handler.current = on_event;

  const client = useMemo(() => {
    const save = (list: type_presence[]) =>
      set_statuses((current) => ({
        ...current,
        ...Object.fromEntries(list.map((item) => [item.user_id, item])),
      }));
    const created = create_presence_client({
      api_url: import.meta.env.VITE_API_URL,
      socket_url: import.meta.env.VITE_SOCKET_URL,
      headers: () => ({ 'x-user-id': String(user_id) }),
      on_event: (event) => {
        if (event.type === 'presence.updated')
          save([event.data as type_presence]);
        else handler.current(event);
      },
      on_reconnected: () =>
        void created
          .find(watched.current)
          .then(save)
          .catch(() => undefined),
    });
    return created;
  }, [user_id]);

  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);

  const watched_key = [...new Set(watched_user_ids)]
    .sort((a, b) => a - b)
    .join(',');

  useEffect(() => {
    if (!watched_key) return;
    void client
      .find(watched_key.split(',').map(Number))
      .then((list) =>
        set_statuses((current) => ({
          ...current,
          ...Object.fromEntries(list.map((item) => [item.user_id, item])),
        })),
      )
      .catch(() => undefined);
  }, [client, watched_key]);

  return (
    <presence_context.Provider value={{ statuses, client }}>
      {children}
    </presence_context.Provider>
  );
}

export function usePresence(user_id: number) {
  return (
    useContext(presence_context).statuses[user_id]?.presence_status ?? 'offline'
  );
}

export function usePresenceClient() {
  return useContext(presence_context).client;
}
```

Usage:

```tsx
<PresenceProvider
  user_id={current_user_id}
  watched_user_ids={teammate_ids}
  on_event={route_room_event}
>
  <App />
</PresenceProvider>
```

```tsx
function TeammateRow({ user }: { user: { user_id: number; name: string } }) {
  const status = usePresence(user.user_id);
  return (
    <div>
      {user.name} <span className={`presence-dot presence-dot-${status}`} />
    </div>
  );
}
```

- Mount `PresenceProvider` once, after the user is known.
- `route_room_event` is where `room.ring`, `room.invited` and the other room events go (section 5.4).
- Colors: `online` green, `away` yellow, `busy` red, `offline` grey.

## 8. Platform notes

**Desktop (Tauri):**

- `WebSocket` and `fetch` work as in a browser.
- Allow the API in the Content Security Policy: `connect-src` must include the API URL and the WebSocket URL (`http://localhost:3000 ws://localhost:3000` in dev, `https://<api-domain> wss://<api-domain>` in production).

**Mobile (React Native):**

- `WebSocket` and `fetch` are built in; the same client works. Replace `import.meta.env` with your config system.
- Listen to `AppState`: on `background`, call `client.stop()` (saves battery; the user becomes offline after up to 45 s); on `active`, call `client.start()` and refresh `find`.
- Incoming calls while the app is closed need push notifications (planned `device` module), not this socket.

## 9. Integration checklist (for an AI agent)

1. Create `packages/presence-client` with `presence-client.ts` from section 7.1 and an `index.ts` that exports it.
2. Add `VITE_API_URL` and `VITE_SOCKET_URL` (or the React Native equivalent) to the frontend config.
3. Create the provider and hooks from section 7.2.
4. Mount `PresenceProvider` at the app root after the current user is known; pass the ids of users visible in the UI as `watched_user_ids`.
5. Show `usePresence(user_id)` as a colored dot next to user names.
6. Add a status picker that calls `client.set_status('online' | 'away' | 'busy' | 'offline')`, with labels "Online", "Away", "Do not disturb", "Appear offline".
7. Create `route_room_event(event)` with a `switch` on `event.type` and empty handlers for the planned room events; ignore unknown types.
8. Keep the `x-user-id` header in one place (`headers()`), ready to be replaced by a bearer token.
9. Do not add other WebSockets for presence, do not poll `GET /presence` on a timer, and do not set `busy` when joining a meeting (the backend does it).

## 10. How to test it

Start the backend (`bun run dev:backend` at the repo root, with `ENV=dev`), then:

| Test                                                               | Expected result                                                                                                                        |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Open the app as user 1 (`x-user-id: 1`)                            | Network tab: `POST /presence/ticket` → `200`, then a WebSocket to `/presence/ws?ticket=...` that stays open; a ping is sent every 20 s |
| Open a second app or browser profile as user 2 (same organization) | User 2 sees user 1 as `online`                                                                                                         |
| User 1 picks "Away"                                                | User 2 sees `away` within a second                                                                                                     |
| User 1 picks "Appear offline"                                      | User 2 sees `offline`; after user 1 restarts the app, still `offline`                                                                  |
| User 1 closes the app                                              | User 2 sees `offline` within a second                                                                                                  |
| Stop the backend, then start it again                              | User 1's app reconnects by itself (new ticket each try) and refreshes statuses                                                         |
| User 3 from another organization                                   | User 3 never sees user 1's status                                                                                                      |
| Reuse an old ticket manually                                       | The connection is refused                                                                                                              |

Quick manual check from a browser console:

```javascript
const ticket = (
  await (
    await fetch('http://localhost:3000/presence/ticket', {
      method: 'POST',
      headers: { 'x-user-id': '1' },
    })
  ).json()
).data.ticket;
const ws = new WebSocket(`ws://localhost:3000/presence/ws?ticket=${ticket}`);
ws.onmessage = (event) => console.log(JSON.parse(event.data));
ws.onopen = () =>
  ws.send(
    JSON.stringify({
      type: 'presence.status',
      data: { presence_status: 'away' },
    }),
  );
```

The console shows `presence.updated` with `online`, then `away`.

## 11. What will change later

- **Login:** `x-user-id` is replaced by `authorization: Bearer <token>`; only `headers()` changes.
- **Socket URL:** the ticket response may add a `socket_url` field; when it does, use it instead of building the URL.
- **Room events:** the room team will start sending the planned `room.*` events; add handlers in `route_room_event`.
- **Visibility:** people who share a meeting with you will also see your status.
