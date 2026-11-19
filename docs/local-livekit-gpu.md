# Local LiveKit with a remote GPU worker

This development layout runs the frontend, backend and LiveKit on your PC. The
remote GPU worker receives room audio and publishes captions through a private
SSH link. Azure is not needed for LiveKit in this layout.

Configure the local root `.env`:

```dotenv
LIVEKIT_URL=http://127.0.0.1:7880
LIVEKIT_PUBLIC_URL=wss://localhost:3100/livekit
PUBLIC_APP_URL=https://localhost:3100
MAWIID_AI_REMOTE=1
MAWIID_LIVEKIT_LOCAL_GPU=1
MAWIID_GPU_SSH_HOST=user@gpu-host
MAWIID_GPU_SSH_PORT=22
MAWIID_GPU_SSH_KEY=/absolute/path/to/your/ssh-key
```

Keep `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` consistent with the GPU worker.
`make livekit` writes a private config under `.secrets/`, starts LiveKit using
the WSL Docker host network, enables loopback media candidates, and delivers
webhooks directly to the local backend. `make gpu-link` holds these loopback-only
reverse forwards open on the GPU server and reconnects after interruptions:

| GPU server listener | Destination on your PC | Purpose |
| --- | --- | --- |
| `127.0.0.1:17880` | `127.0.0.1:7880` | LiveKit signaling and API |
| `127.0.0.1:7881` | `127.0.0.1:7881` | WebRTC over TCP |
| `127.0.0.1:13000` | `127.0.0.1:3000` | Transcript uploads |

On the GPU server, the existing `.env.live` should contain:

```dotenv
LIVEKIT_URL=ws://127.0.0.1:17880
LIVEKIT_TRANSLATOR_AGENT=mawiid-translator
MAWIID_BACKEND_URL=http://127.0.0.1:13000
```

Set its `INTERNAL_SERVICE_TOKEN` to the same token used by the local backend
(`apps/backend/postman/.env.postman` for `make backend`). The GPU model settings
and `GEMINI_API_KEY` remain on the GPU host.

Start locally with `make dev`. It starts the private link automatically and skips
local AI installation and model conversion. For individual services, run
`make livekit`, `make gpu-link`, `make backend`, and `make frontend` in separate
terminals. The GPU worker can remain in its existing `mawiid-ai` tmux session.

Open `https://localhost:3100` on this PC. The backend uses `LIVEKIT_URL` to reach
LiveKit directly over local HTTP; it returns `LIVEKIT_PUBLIC_URL` to the browser,
which uses the local frontend's HTTPS/WebSocket proxy. The GPU server uses the
private SSH link. None of these connections needs a Cloudflare tunnel. The local
HTTPS development certificate may need to be accepted in the browser once.

This media arrangement is for the browser on your development PC and the
SSH-connected worker. Sharing the app URL with other Internet users does not
make your local media ports public. Use the planned CPU server deployment with
reachable media ports or TURN for those clients. Keep this PC, WSL, the app
services, and the SSH link running while testing.
