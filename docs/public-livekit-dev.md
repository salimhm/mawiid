# Public LiveKit with a local app and remote GPU worker

Use this layout when other PCs or phones need to join. The PC-only configuration
in `local-livekit-gpu.md` advertises private media addresses and cannot serve
those clients over an app tunnel alone.

- The app and backend run on the development PC, exposed by the current app tunnel.
- LiveKit runs on the public CPU server `lds-server`.
- The AI worker runs on the A100 server and connects directly to public LiveKit.

Local root `.env`:

```dotenv
LIVEKIT_URL=https://<current-livekit-signaling-host>
LIVEKIT_PUBLIC_URL=wss://<current-livekit-signaling-host>
PUBLIC_APP_URL=https://<current-app-tunnel>
MAWIID_AI_REMOTE=1
MAWIID_LIVEKIT_REMOTE=1
MAWIID_LIVEKIT_SSH_HOST=lds-server
MAWIID_LIVEKIT_LOCAL_GPU=0
```

The GPU server's `.env.live` uses the same LiveKit credentials, the public
`LIVEKIT_URL`, and `MAWIID_BACKEND_URL=https://<current-app-tunnel>/api`.
Its `INTERNAL_SERVICE_TOKEN` matches the local backend's token. No private SSH
media forwards or Tailscale access are needed by meeting participants.

On `lds-server`, the private configuration is in `~/mawiid-livekit/livekit.yaml`.
`mawiid-livekit-dev` publishes TCP 7881 and UDP 7882 on the public server and
advertises that server's public IP. Docker maps signaling to host loopback 7880;
`mawiid-livekit-tunnel` exposes signaling over HTTPS/WSS. LiveKit's webhook points
to `https://<current-app-tunnel>/api/webhook/livekit`.

```sh
docker ps --filter name=mawiid-livekit
docker logs --tail 50 mawiid-livekit-dev
docker logs --tail 50 mawiid-livekit-tunnel
```

From the local repository, `make infra-logs` follows the public LiveKit logs over
SSH. `make infra` checks the public signaling endpoint and leaves local LiveKit
stopped; `make gpu-link` is no longer required.

Quick Tunnel hostnames are temporary. If either tunnel changes its hostname,
update the matching local/GPU environment settings and LiveKit webhook URL,
then restart the affected services. Use stable DNS/TLS endpoints for production.
Keep the app/backend and their tunnel running while testing. After changing
LiveKit servers, refresh and rejoin existing meetings.
