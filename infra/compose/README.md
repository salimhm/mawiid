# Mawiid single-VPS deployment

This Docker Compose bundle deploys the production Mawiid web app, API, Redis, and a self-hosted LiveKit server on one Debian VPS.

For a complete handoff guide covering the project architecture, production operations, rollout, rollback limits, and troubleshooting, read [`docs/production-vps-deployment.md`](../../docs/production-vps-deployment.md).

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

It opens no public port; it registers with LiveKit over the private Docker network. The first start downloads the Whisper model. Configure `MAWIID_MT_MODEL_PATH` only after placing the converted MADLAD model in the `ai_models` volume.

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
