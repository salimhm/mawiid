#!/usr/bin/env bash
# Private development connection from the GPU container back to local LiveKit/backend.
set -euo pipefail

project_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_directory"
mkdir -p .secrets
# One link per checkout, including when make dev is restarted alongside tmux.
exec 9>.secrets/gpu-link.lock
flock -n 9 || { echo "The private GPU link is already running."; exit 0; }

gpu_host="${MAWIID_GPU_SSH_HOST:?Set MAWIID_GPU_SSH_HOST in .env}"
gpu_key="${MAWIID_GPU_SSH_KEY:?Set MAWIID_GPU_SSH_KEY in .env}"
gpu_port="${MAWIID_GPU_SSH_PORT:-22}"
[[ -f "$gpu_key" ]] || { echo "GPU SSH key file does not exist: $gpu_key"; exit 1; }
ssh_pid=""
cleanup() {
  trap - INT TERM
  if [[ -n "$ssh_pid" ]]; then
    kill "$ssh_pid" 2>/dev/null || true
    wait "$ssh_pid" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup INT TERM

while true; do
  echo "$(date -u +%FT%TZ) Connecting the private GPU link..."
  ssh -NT -i "$gpu_key" -p "$gpu_port" \
    -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ConnectTimeout=10 -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
    -R 127.0.0.1:17880:127.0.0.1:7880 \
    -R 127.0.0.1:7881:127.0.0.1:7881 \
    -R 127.0.0.1:13000:127.0.0.1:3000 \
    "$gpu_host" &
  ssh_pid=$!
  wait "$ssh_pid" || true
  ssh_pid=""
  echo "$(date -u +%FT%TZ) GPU link closed; reconnecting in 3 seconds."
  sleep 3
done
