# bun-react-tailwind-shadcn-template

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To run for production:

```bash
bun start
```

This project was created using `bun init` in bun v1.4.0. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Connecting to the backend

The dev server proxies `/api/*` (HTTP and WebSocket) to the Mawiid backend, so the browser only talks to one origin.

```bash
BACKEND_URL=http://localhost:3000 bun dev   # BACKEND_URL defaults to http://localhost:3000
```

Sign in at `/login` (`/welcome` and `/meet/*` redirect there when signed out) with a username or email and a password, or
create an account there. The seeded users sign in as `host`, `moderator`, `member`, `viewer`, `guest` or `outsider` (or
`<name>@mawiid.test`) with the password `mawiid-password`. The "Phone code" tab keeps the phone and 6-digit code flow: with
the backend in `ENV=dev` the code is filled in for you, and the seeded numbers are `+21355000000` to `+21355000005`.

The access token is kept in memory only. The refresh token is an `HttpOnly` cookie set by the backend, so it is never
readable from JavaScript; on page load the app calls `/auth/refresh` to restore the session, and an expired access token
is refreshed automatically. Tabs take turns refreshing (Web Locks API) and signing out in one tab signs out the others.

For quick testing you can still skip the login: open the app once with `?token=<jwt>` (see `make tokens`) or set
`BUN_PUBLIC_DEV_TOKEN` when starting the dev server. Those tokens are kept in `localStorage` and cannot be refreshed.

Join a room by typing its `room_uid` on the landing page. Media goes directly from the browser to LiveKit at the
`server_url` the backend returns (`LIVEKIT_PUBLIC_URL`), so LiveKit must be reachable from the browser.

For a Windows browser testing against LiveKit on the same machine in WSL, use
`LIVEKIT_PUBLIC_URL=ws://localhost:7880` in `apps/backend/postman/.env.postman` and restart
`bun run postman:dev`. A stale LAN IP can prevent the browser from connecting even while
the backend successfully creates media rooms. When using `make backend` or `make dev`,
the root `.env` supplies the LiveKit settings instead.
