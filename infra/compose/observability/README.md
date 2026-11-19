# Local Prometheus and Grafana

This stack is intentionally separate from the application Compose deployment. It runs only Prometheus and Grafana in Docker; the Mawiid backend and AI worker continue to run directly on the host through their normal CLI commands.

Prometheus reaches host processes at `host.docker.internal`. Docker Desktop provides that hostname on Windows and macOS. The Compose file adds the standard `host-gateway` mapping so the same configuration also works on Linux Docker Engine.

## Start the dashboard stack

```sh
cd infra/compose/observability
cp .env.example .env
# Replace the example value in .env with a local Grafana password.
docker compose up -d
```

In PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Grafana is available at `http://localhost:3001` with username `admin`. Prometheus is available for troubleshooting only at `http://localhost:9090`. Both bind to localhost and are not exposed on the network.

Grafana provisions the **Local service latency** dashboard automatically.

## Run the services on the host

Start the Bun backend as usual:

```sh
bun run dev:backend
```

It exposes Prometheus metrics at `http://localhost:3000/metrics`. Every request is measured as `mawiid_http_server_duration_seconds`, with method, normalised route, and HTTP status labels.

For a quick check in PowerShell after the backend starts:

```powershell
Invoke-WebRequest http://localhost:3000/metrics | Select-Object -Expand Content
```

When running the AI worker, leave `MAWIID_METRICS_ENABLED` unset or set it to `true`. It exposes metrics at `http://localhost:9464/metrics` by default. If its port is already used, set `MAWIID_METRICS_PORT` before starting it.

```sh
MAWIID_METRICS_PORT=9464 python -m mawiid_ai.agent dev
```

In PowerShell, set the variable separately:

```powershell
$env:MAWIID_METRICS_PORT = '9464'
python -m mawiid_ai.agent dev
```

The AI worker reports transcription, translation, queue, caption publishing, active tracks, errors, and audio-end-to-LiveKit-publication latency. It intentionally never exports caption text, room IDs, identities, or audio as metric labels.

## Verify

After starting Prometheus and the backend, open `http://localhost:9090/targets`. The `backend` target should be **UP**. The `ai` target is expected to be down until the AI worker starts.

Generate a few backend requests, then open Grafana and use the provisioned dashboard. To generate AI metrics, join a test room, enable captions, and speak for a few seconds. Prometheus scrapes every five seconds, so new series normally appear within ten seconds.
