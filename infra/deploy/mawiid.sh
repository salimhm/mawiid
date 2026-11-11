#!/usr/bin/env bash
# One-command production deployment: `make mawiid` from the repository root.
#
# On a fresh Debian or Ubuntu server it installs Docker and the other host tools, creates
# infra/compose/.env.production with generated secrets, builds and starts the stack (Caddy with
# HTTPS, backend, Redis, LiveKit), migrates the database, then converts the translation model and
# starts the AI worker. Safe to run again: it is also the update command after a git pull.
#
# Settings (environment or make variables):
#   APP_DOMAIN, RTC_DOMAIN  public hostnames, written to .env.production (default: the file's values)
#   AI=0 (make: WITH_AI=0)  skip the AI translation worker and its model conversion
#   GPU=auto|1|0            use the NVIDIA GPU for the AI worker (auto: when nvidia-smi works)
#   MT_MODEL=3b|10b         MADLAD size, written to .env.production (default: the file's, else 10b on GPU, 3b on CPU)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
COMPOSE_DIR=$ROOT/infra/compose
ENV_FILE=$COMPOSE_DIR/.env.production
AI=${AI:-1}
GPU=${GPU:-auto}

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWARNING:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then SUDO=; else
  command -v sudo >/dev/null || die "Run as root, or install sudo."
  SUDO=sudo
fi

# ---------------------------------------------------------------- host tools

has_nvidia_gpu() { grep -qs 0x10de /sys/bus/pci/devices/*/vendor; }

install_docker() {
  . /etc/os-release
  case "${ID:-}" in debian | ubuntu) ;; *) die "Unsupported OS '${ID:-?}': install Docker Engine and the Compose plugin by hand, then rerun." ;; esac
  $SUDO install -m 0755 -d /etc/apt/keyrings
  $SUDO curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  $SUDO chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" |
    $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update -q
  $SUDO apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker
  [ -n "$SUDO" ] && $SUDO usermod -aG docker "$USER" || true
}

install_nvidia_toolkit() {
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey |
    $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list |
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' |
    $SUDO tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
  $SUDO apt-get update -q
  $SUDO apt-get install -y -q nvidia-container-toolkit
  $SUDO nvidia-ctk runtime configure --runtime=docker
  $SUDO systemctl restart docker
}

step "Host tools"
if command -v apt-get >/dev/null; then
  missing=()
  for pkg in ca-certificates curl openssl gnupg gettext-base; do dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg"); done
  if [ ${#missing[@]} -gt 0 ]; then
    $SUDO apt-get update -q
    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${missing[@]}"
  fi
fi
for tool in curl openssl envsubst; do command -v $tool >/dev/null || die "Missing $tool: install it, then rerun."; done
if ! $SUDO docker compose version >/dev/null 2>&1; then
  echo "Installing Docker Engine and the Compose plugin"
  install_docker
fi
$SUDO systemctl is-active --quiet docker 2>/dev/null || $SUDO systemctl start docker 2>/dev/null || true

# Until the user logs in again, a new docker group membership is not active: use sudo meanwhile.
if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=($SUDO docker); fi
"${DOCKER[@]}" info >/dev/null 2>&1 || die "Docker is installed but not running: sudo systemctl start docker"
echo "$("${DOCKER[@]}" --version)"

use_gpu=0
if [ "$AI" = 1 ] && [ "$GPU" != 0 ]; then
  if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
    use_gpu=1
    if ! "${DOCKER[@]}" info 2>/dev/null | grep -qi 'runtimes:.*nvidia'; then
      echo "Installing the NVIDIA Container Toolkit"
      install_nvidia_toolkit
    fi
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
  elif [ "$GPU" = 1 ]; then
    die "GPU=1 but nvidia-smi does not work: install the NVIDIA driver first (on Azure: the NVIDIA GPU Driver extension), reboot, then rerun."
  elif has_nvidia_gpu; then
    warn "An NVIDIA GPU is present but its driver is not installed (nvidia-smi fails). The AI worker will run on the CPU.
         Install the driver (on Azure: the 'NVIDIA GPU Driver Extension'), reboot, and rerun make mawiid to use the GPU."
  fi
fi

# Open the public ports when ufw is in use. Cloud firewalls (Azure NSG, etc.) must be opened separately.
if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q 'Status: active'; then
  echo "Opening the firewall ports in ufw"
  for rule in 22/tcp 80/tcp 443/tcp 443/udp 7881/tcp 3478/udp 50000:60000/udp; do $SUDO ufw allow "$rule" >/dev/null; done
fi

# ---------------------------------------------------------------- configuration

step "Configuration ($ENV_FILE)"
get_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1; }
set_env() {
  if grep -q "^$1=" "$ENV_FILE"; then
    local tmp; tmp=$(mktemp); awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "$ENV_FILE" >"$tmp"
    cat "$tmp" >"$ENV_FILE"; rm -f "$tmp"
  else printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"; fi
}

if [ ! -f "$ENV_FILE" ]; then
  (umask 077; cp "$COMPOSE_DIR/.env.production.example" "$ENV_FILE")
  echo "Created .env.production from the template"
fi
chmod 600 "$ENV_FILE"

for key in JWT_SECRET_KEY LIVEKIT_API_SECRET INTERNAL_SERVICE_TOKEN; do
  [ -n "$(get_env $key)" ] || { set_env $key "$(openssl rand -hex 32)"; echo "Generated $key"; }
done
[ -n "$(get_env LIVEKIT_API_KEY)" ] || set_env LIVEKIT_API_KEY mawiid-production
# Domains: the make/env value wins, else the file's, else the template's.
for key in APP_DOMAIN RTC_DOMAIN; do
  value=${!key:-$(get_env $key)}
  value=${value:-$(sed -n "s/^$key=//p" "$COMPOSE_DIR/.env.production.example")}
  set_env $key "$value"
done
set_env AI_CUDA "$use_gpu"
if [ -n "${MT_MODEL:-}" ]; then
  set_env MAWIID_MT_MODEL "$MT_MODEL"
elif [ -z "$(get_env MAWIID_MT_MODEL)" ]; then
  if [ "$use_gpu" = 1 ]; then set_env MAWIID_MT_MODEL 10b; else set_env MAWIID_MT_MODEL 3b; fi
fi

# Read back without sourcing: Docker env files are not shell (SMTP_FROM=Name <a@b> is valid there).
APP_DOMAIN=$(get_env APP_DOMAIN); RTC_DOMAIN=$(get_env RTC_DOMAIN)
TURSODB_URL=$(get_env TURSODB_URL); MAWIID_MT_MODEL=$(get_env MAWIID_MT_MODEL)
echo "Website  https://$APP_DOMAIN"
echo "LiveKit  wss://$RTC_DOMAIN"
echo "Database ${TURSODB_URL}"
echo "AI       $([ "$AI" = 1 ] && echo "on, $([ "$use_gpu" = 1 ] && echo GPU || echo CPU), MADLAD $MAWIID_MT_MODEL" || echo off)"

public_ip=$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || true)
if [ -n "$public_ip" ] && command -v getent >/dev/null; then
  for host in "$APP_DOMAIN" "$RTC_DOMAIN"; do
    resolved=$(getent ahostsv4 "$host" | awk 'NR==1{print $1}')
    [ "$resolved" = "$public_ip" ] ||
      warn "$host resolves to '${resolved:-nothing}', not this server ($public_ip). Point its A record here (DNS only), or HTTPS certificates cannot be issued."
  done
fi

(cd "$COMPOSE_DIR" && LIVEKIT_API_KEY=$(get_env LIVEKIT_API_KEY) LIVEKIT_API_SECRET=$(get_env LIVEKIT_API_SECRET) sh ./render-livekit-config.sh)

# ---------------------------------------------------------------- build and start

compose() {
  local files=(-f docker-compose.yml)
  [ "$use_gpu" = 1 ] && files+=(-f docker-compose.gpu.yml)
  (cd "$COMPOSE_DIR" && "${DOCKER[@]}" compose --env-file .env.production "${files[@]}" "$@")
}

step "Building images (the first build takes several minutes)"
compose build caddy backend

step "Migrating the main database"
compose run --rm backend bun src/db/migrate.db.ts

step "Starting the website, API, Redis and LiveKit"
compose up -d --remove-orphans caddy backend redis livekit

echo -n "Waiting for the backend"
for i in $(seq 1 60); do
  if compose exec -T backend bun -e "process.exit((await fetch('http://localhost:3000/health')).ok ? 0 : 1)" >/dev/null 2>&1; then
    echo " ready"; break
  fi
  [ "$i" = 60 ] && { echo; compose logs --tail=80 backend; die "The backend did not start: see the logs above."; }
  echo -n "."; sleep 2
done

echo -n "Waiting for HTTPS on $APP_DOMAIN"
site_ok=0
for i in $(seq 1 45); do
  if curl -fsS --max-time 5 --resolve "$APP_DOMAIN:443:127.0.0.1" "https://$APP_DOMAIN/api/health" >/dev/null 2>&1; then
    site_ok=1; echo " ready"; break
  fi
  echo -n "."; sleep 2
done
if [ "$site_ok" = 0 ]; then
  echo
  warn "https://$APP_DOMAIN is not answering yet: Caddy has no certificate. Check DNS and that ports 80/443 are open, then: make mawiid-logs"
fi

# ---------------------------------------------------------------- AI worker

if [ "$AI" = 1 ]; then
  step "AI translation worker"
  compose --profile ai build ai
  model_dir=/models/madlad400-$MAWIID_MT_MODEL-mt-ct2
  if compose --profile ai run --rm --no-deps ai test -f "$model_dir/model.bin" 2>/dev/null; then
    echo "MADLAD $MAWIID_MT_MODEL is ready"
  else
    echo "Converting MADLAD $MAWIID_MT_MODEL once (large download; 10b needs ~24 GB of RAM). The website is already up."
    compose --profile ai run --rm --no-deps ai sh -c \
      "pip install -q torch --index-url https://download.pytorch.org/whl/cpu && pip install -q '.[convert]' \
       && python scripts/convert_translation_model.py --model $MAWIID_MT_MODEL \
       && rm -rf /root/.cache/huggingface" ||
      warn "The model conversion failed: the worker starts anyway and captions stay in the spoken language. Rerun make mawiid to retry."
  fi
  compose --profile ai up -d ai
else
  compose --profile ai stop ai >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------- summary

step "Done"
compose --profile ai ps
cat <<EOF

  Website   https://$APP_DOMAIN
  Logs      make mawiid-logs        Status  make mawiid-status        Stop  make mawiid-down

  Cloud firewall (e.g. Azure NSG) must allow inbound: 80/tcp 443/tcp 443/udp 7881/tcp 3478/udp 50000-60000/udp
EOF
[ -n "$(get_env SMTP_USER)" ] && [ -n "$(get_env GOOGLE_APP_PASSWORD)" ] ||
  warn "SMTP is not configured: registration and password-reset emails cannot be sent. Set SMTP_* and GOOGLE_APP_PASSWORD in $ENV_FILE, then rerun make mawiid."
if [ "${DOCKER[0]}" != docker ]; then echo "  Log out and back in to use docker without sudo."; fi
