# GPU VM Prometheus and Grafana

Run this Compose stack on the Ubuntu GPU VM, beside the AI worker and its models. The Bun backend remains on its separate application VM.

Prometheus uses Linux host networking to scrape these private endpoints:

- `127.0.0.1:9464/metrics` — the AI worker on the GPU VM.
- `<APP_VM_PRIVATE_IP>:3000/metrics` — the Bun backend through the private VM network.

Grafana and Prometheus each bind only to `127.0.0.1` on the GPU VM. This Compose file is deliberately for Linux Docker Engine, not Docker Desktop.

## Start Prometheus and Grafana on the GPU VM

```sh
cd infra/compose/observability
cp .env.example .env
# Edit .env: set a strong Grafana password and the application's private VM IP.
docker compose up -d
```

Use the actual private address of the app VM for `APP_VM_PRIVATE_IP`; it must be reachable from the GPU VM. Do not put a public IP here.

Use an SSH tunnel to open the dashboard from your laptop:

```sh
ssh -L 3001:127.0.0.1:3001 your-user@gpu-vm
```

Then visit `http://localhost:3001` and sign in as `admin`. For Prometheus troubleshooting, tunnel port `9090` in the same way and open `http://localhost:9090/targets`.

## Run the AI worker on the GPU VM

Start the worker on the GPU VM—the machine that has the models. Its metrics endpoint is private to that VM by default:

```sh
MAWIID_METRICS_HOST=127.0.0.1 \
MAWIID_METRICS_PORT=9464 \
python -m mawiid_ai.agent start
```

Use the project's normal worker command if it differs in your deployment. The important part is that the worker process is running on the GPU VM and has `MAWIID_METRICS_ENABLED` unset or set to `true`.

## Run the Bun backend on the app VM

Start the backend normally on the app VM. It exposes `GET /metrics` on its Bun port (normally `3000`). Allow **only the GPU VM's private IP** to reach TCP port `3000`, for example with UFW:

```sh
sudo ufw allow from <GPU_VM_PRIVATE_IP> to any port 3000 proto tcp
```

Do not expose the Bun port publicly. The Caddy deployment configuration also returns `404` for public `/api/metrics`; Prometheus reaches the backend port directly through the private network.

## Verify

Open Prometheus **Status → Targets**. Both `backend` and `ai` should be **UP**:

- If `backend` is down, check `APP_VM_PRIVATE_IP`, the backend process, and the private-network firewall rule.
- If `ai` is down, check that the worker runs on the GPU VM and that port `9464` is listening on loopback.

Generate normal backend requests, then run a real caption session. Prometheus scrapes every five seconds, so dashboard series normally appear within 10–15 seconds. Caption p95 stays `No data` until at least one caption reaches the relevant pipeline stage; translation metrics only appear when a translation is actually produced.
