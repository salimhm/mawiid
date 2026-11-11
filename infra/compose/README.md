# Mawiid single-VPS deployment

This Docker Compose bundle deploys the production Mawiid web app, API, Redis, and a self-hosted LiveKit server on one Debian VPS.

For a complete handoff guide covering the project architecture, production operations, rollout, rollback limits, and troubleshooting, read [`docs/production-vps-deployment.md`](../../docs/production-vps-deployment.md).

## One command

On a fresh Debian or Ubuntu server, from the repository root:

```sh
make mawiid                                    # or: make mawiid APP_DOMAIN=app.example.com RTC_DOMAIN=rtc.example.com
```

It installs Docker, the Compose plugin, and the NVIDIA Container Toolkit when a GPU driver is present. It creates `.env.production` from `.env.production.example` with generated secrets and renders the LiveKit config. Then it builds the images, migrates the database, and starts the stack. Last, it converts the translation model and starts the AI worker. Without Turso settings the data is kept in SQLite files in the `backend_data` volume. Rerun it after `git pull` to update. `WITH_AI=0` skips the AI worker; `GPU=0` keeps it on the CPU. `make mawiid-status`, `make mawiid-logs` and `make mawiid-down` manage the running stack.

**Azure GPU VM** (Ubuntu 22.04/24.04, e.g. Standard_NV36ads_A10_v5): run `make azure` instead (same options, plus `MT_MODEL=10b|3b` and `REBOOT=1`). Before `make mawiid` it installs the NVIDIA driver the VM size needs (Microsoft's GRID driver on NV-series, which requires Secure Boot off; Ubuntu's signed driver on NC/ND-series), asks for the one reboot that needs, then checks the disk (~80 GB free for 10b: grow the 30 GB default OS disk first) and RAM (~26 GB for the conversion). It then deploys with the GPU and MADLAD 10b, and checks that the AI worker sees the GPU. After a reboot, run `make azure` again; it carries on where it stopped. Open the ports listed at the end in the VM's network security group.

DNS records and the cloud firewall (below) cannot be set from the server: do them first. Email (registration, password reset) needs the `SMTP_*` values in `.env.production`.

The sections below are the same steps done by hand.

## Public endpoints

| Hostname | Role |
| --- | --- |
| `mawiid.laedxdigitalstudio.com` | React frontend and `/api` proxy |
| `rtc.mawiid.laedxdigitalstudio.com` | LiveKit secure WebSocket signaling |

Create an `A` record for each hostname pointing to the VPS public IPv4 address. If these records are managed by Cloudflare, set both to **DNS only** (grey cloud). The normal Cloudflare proxy cannot carry LiveKit's public WebRTC UDP traffic.

Before deployment, open these inbound ports in both the VPS provider firewall and Debian firewall:

| Port | Protocol | Reason |
| --- | --- | --- |
| 80 | TCP | Caddy ACME certificate issuance and HTTP redirect |
| 443 | TCP | HTTPS frontend and secure LiveKit signaling |
| 443 | UDP | Optional HTTP/3 for the frontend |
| 7881 | TCP | WebRTC fallback for networks that block UDP |
| 3478 | UDP | Embedded LiveKit TURN/STUN |
| 50000-60000 | UDP | WebRTC media |

Do not expose port 3000, 6379, or 7880. Docker keeps those services on its private network.

## First deployment

Install Docker Engine, the Docker Compose plugin, Git, and `gettext-base` on the VPS. `envsubst` from `gettext-base` renders the private LiveKit configuration without committing secrets.

```sh
sudo apt update
sudo apt install -y ca-certificates curl git gettext-base
# Install Docker Engine and the Compose plugin using Docker's current Debian instructions.
```

Clone the project, prepare the production environment, and generate independent high-entropy secrets:

```sh
git clone <your-repository-url> mawiid
cd mawiid/infra/compose
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

Set the Turso, SMTP, and production secrets in `.env.production`. In particular, use separate values for `TURSODB_TOKEN` (main-database auth) and `TURSODB_API_TOKEN` (Turso Platform API, used to provision a new user's vault).

Generate a new LiveKit server secret and JWT secret, for example:

```sh
openssl rand -base64 48
```

Render the secret-bearing LiveKit configuration, run the main-database migrations, then start the stack:

```sh
set -a
. ./.env.production
set +a
sh ./render-livekit-config.sh

docker compose --env-file .env.production -f docker-compose.yml build
docker compose --env-file .env.production -f docker-compose.yml run --rm backend bun src/db/migrate.db.ts
docker compose --env-file .env.production -f docker-compose.yml up -d
```

The migration command is safe to repeat. Do **not** run `make seed` on the VPS: it is only for disposable local test data.

## Verify

```sh
docker compose --env-file .env.production -f docker-compose.yml ps
docker compose --env-file .env.production -f docker-compose.yml logs -f caddy backend livekit
curl -fsS https://mawiid.laedxdigitalstudio.com/api/health
```

After Caddy has issued certificates, create a room and join from two different networks. The join response must give the browser `wss://rtc.mawiid.laedxdigitalstudio.com`, never a `ws://` or private-IP URL.

## Optional AI translation worker

The AI worker is intentionally in the `ai` Compose profile because Whisper and the translation model need substantial CPU, memory, and disk. Start it only after the normal call flow is healthy:

```sh
docker compose --env-file .env.production -f docker-compose.yml --profile ai up -d --build ai
docker compose --env-file .env.production -f docker-compose.yml logs -f ai
```

It opens no public port; it registers with LiveKit over the private Docker network. The first start downloads the Whisper model.

On a host with an NVIDIA GPU (Azure NV36ads A10 v5 or similar: the NVIDIA driver and the NVIDIA Container Toolkit must be installed), add `-f docker-compose.gpu.yml` to every command and set `AI_CUDA=1` in `.env.production`, which puts the CUDA 12 / cuDNN 9 libraries in the image. Without them the worker runs on the CPU.

Translation uses MADLAD-400, converted once into the `ai_models` volume. Set `MAWIID_MT_MODEL=10b` in `.env.production` (`3b` on a CPU host), then convert that size (10b: ~43 GB download into `ai_cache`, ~24 GB of RAM, ~11 GB written to `/models`):

```sh
docker compose --env-file .env.production -f docker-compose.yml --profile ai run --rm ai sh -c \
  "pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install '.[convert]' \
   && python scripts/convert_translation_model.py --model 10b"
docker compose --env-file .env.production -f docker-compose.yml --profile ai restart ai
```

The Darija speech model goes to the same volume the same way (`python scripts/convert_darija_model.py --model turbo`). Hugging Face downloads stay in the `ai_cache` volume; delete `/root/.cache/huggingface` in it afterwards to free the space.

## Updates

```sh
git pull
cd infra/compose
set -a && . ./.env.production && set +a
sh ./render-livekit-config.sh
docker compose --env-file .env.production -f docker-compose.yml build
docker compose --env-file .env.production -f docker-compose.yml run --rm backend bun src/db/migrate.db.ts
docker compose --env-file .env.production -f docker-compose.yml up -d
```

Use `docker compose --env-file .env.production -f docker-compose.yml logs -f <service>` when diagnosing startup issues.
