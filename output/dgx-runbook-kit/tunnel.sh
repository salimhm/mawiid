#!/usr/bin/env bash
# Keeps one outbound SSH connection from the DGX to the VM open, and reconnects when it drops.
#   DGX 127.0.0.1:13000      -> VM bridge :3000  (backend, for transcript saving)
#   VM bridge :9464          -> DGX 127.0.0.1:9464 (worker metrics, for Prometheus on the VM)
# Start it inside tmux:  tmux new -d -s caption-tunnel /workspace/mawiid-run/tunnel.sh
set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$here/env/tunnel.conf"
: "${VM_HOST:?set VM_HOST in env/tunnel.conf}" "${VM_BRIDGE_IP:?set VM_BRIDGE_IP in env/tunnel.conf}"
mkdir -p "$here/logs"

while true; do
  rc=0
  ssh -N \
    -i "$here/env/tunnel_ed25519" \
    -o IdentitiesOnly=yes -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$here/env/known_hosts" \
    -L "127.0.0.1:13000:${VM_BRIDGE_IP}:3000" \
    -R "${VM_BRIDGE_IP}:9464:127.0.0.1:9464" \
    "mawiid-tunnel@${VM_HOST}" || rc=$?
  echo "$(date -u +%FT%TZ) tunnel exited with code $rc; reconnecting in 5 s" >>"$here/logs/tunnel.log"
  sleep 5
done
