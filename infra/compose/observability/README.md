# Mawiid observability on the laptop

Run Prometheus and Grafana in Docker in WSL. Prometheus reaches the Bun backend
through Docker's host gateway. Two SSH forwards use that same gateway to
reach the servers' loopback metrics endpoints.

| Prometheus job | Server | Scrape address inside Docker |
| --- | --- | --- |
| `backend` | Laptop, Bun `3000` | `host.docker.internal:3000` |
| `ai` | GPU `100.66.229.114`, worker `127.0.0.1:9465` | `host.docker.internal:19465` |
| `vllm` | GPU `100.66.229.114`, vLLM `127.0.0.1:8000` | `host.docker.internal:18000` |
| `livekit` | `lds-server` (`152.53.82.54`), LiveKit `127.0.0.1:6789` | `host.docker.internal:16789` |

All jobs scrape `/metrics`. Grafana uses `http://prometheus:9090` on the
Compose network. Grafana and Prometheus publish their UIs on laptop loopback.

## Start or restore collection

From WSL in this directory, keep the existing `.env`. For a fresh install,
copy `.env.example` to `.env` and set a Grafana admin password.

```sh
docker compose config --quiet
docker compose up -d
```

Start the two forwards in separate WSL terminals or tmux sessions.

```sh
bash forward-metrics.sh gpu
bash forward-metrics.sh livekit
```

The script retries disconnected SSH sessions. It uses the laptop's
`~/.ssh/microbat` identity for the GPU and its existing `lds-server` SSH alias
for LiveKit. Start Bun with `make backend` from the repository root if it is
down. If the GPU host has restarted, run `bash run-vllm.sh` and
`bash run-worker.sh` in separate tmux sessions from `/workspace/mawiid-voxtral`.

On `lds-server`, add the `prometheus` field inside the top-level JSON object
in `~/mawiid-livekit/livekit.yaml`.

```json
{
  "prometheus": { "port": 6789 }
}
```

The LiveKit container publishes that port as `127.0.0.1:6789:6789/tcp`. Apply
changes to that container between calls. The SSH forward uses the loopback
port directly.

## Verify

Open [Prometheus Targets](http://localhost:9090/targets). The `backend`,
`ai`, `vllm`, `livekit`, and `prometheus` jobs should be **UP**. Open the
**Local service latency** dashboard in [Grafana](http://localhost:3001) to see
scrape health by service and the backend and caption histograms.

Exercise one backend request, one original caption and one translated
caption. Allow 10–15 seconds for the dashboard to show fresh samples. When
a remote target is down, first check its service locally on the server and
then check the corresponding SSH forward in WSL.
