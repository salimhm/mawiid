# App VM Prometheus and Grafana

Run this Compose stack on the Ubuntu application VM where the Bun backend runs. The GPU VM remains dedicated to the AI worker and models; it does not run Prometheus, Grafana, or Docker monitoring containers.

Prometheus runs in Docker on the app VM and scrapes these endpoints:

- `host.docker.internal:3000/metrics` - Bun backend running directly on the app VM.
- `<GPU_VM_PRIVATE_IP>:9464/metrics` - AI worker on the GPU VM through the private network.

Grafana and Prometheus publish their UI ports only on `127.0.0.1` on the app VM. The Compose file maps `host.docker.internal` through Docker's host gateway so Prometheus can reach the Bun process without containerising it.

## Start Prometheus and Grafana on the app VM

```sh
cd infra/compose/observability
cp .env.example .env
# Edit .env: set a strong Grafana password and the GPU VM's private IP.
docker compose up -d
```

Set `GPU_VM_PRIVATE_IP` to the actual private address of the GPU VM. It must be reachable from the app VM. Do not use a public IP.

Use an SSH tunnel from a laptop to open the dashboard:

```sh
ssh -L 3001:127.0.0.1:3001 your-user@app-vm
```

Then visit `http://localhost:3001` and sign in as `admin`. To inspect Prometheus targets, forward port `9090` in the same way and open `http://localhost:9090/targets`.

## Run the Bun backend on the app VM

Start the backend normally. It exposes `GET /metrics` on port `3000` by default. Prometheus reaches it through Docker's host gateway, so no additional backend firewall rule is needed for monitoring.

```sh
curl -fsS http://127.0.0.1:3000/metrics | head
```

The public Caddy route returns `404` for `/api/metrics`; do not expose the Bun port publicly.

## Run the AI worker on the GPU VM

The GPU VM runs only the AI worker and models. The worker's lightweight metrics endpoint must bind to the GPU VM's private interface so Prometheus on the app VM can scrape it:

```sh
MAWIID_METRICS_HOST=<GPU_VM_PRIVATE_IP> \
MAWIID_METRICS_PORT=9464 \
python -m mawiid_ai.agent start
```

Allow only the app VM's private IP to reach the metrics port on the GPU VM, for example with UFW:

```sh
sudo ufw allow from <APP_VM_PRIVATE_IP> to any port 9464 proto tcp
```

The metrics endpoint contains operational counters and latency histograms only. It does not include caption text, room IDs, participant identities, or audio data.

## Verify

On the app VM, confirm that the GPU worker is reachable:

```sh
curl -fsS http://<GPU_VM_PRIVATE_IP>:9464/metrics | head
```

Open Prometheus **Status -> Targets**. The `backend`, `ai`, and `prometheus` targets should be **UP**.

- If `backend` is down, make sure Bun is running and responding at `127.0.0.1:3000` on the app VM, then inspect the Prometheus container logs.
- If `ai` is down, check the GPU worker, `MAWIID_METRICS_HOST`, GPU firewall or cloud security group, and private-network routing from the app VM.

Generate ordinary backend requests and run a real caption session. Prometheus scrapes every five seconds, so dashboard series normally appear within 10-15 seconds. Caption p95 stays `No data` until a caption reaches that stage; translation metrics appear only after an actual translation is produced.
