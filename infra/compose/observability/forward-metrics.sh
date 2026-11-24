#!/usr/bin/env bash
set -euo pipefail

# Prometheus runs in Docker on the laptop. Bind the forwards only to Docker's
# host gateway, which Prometheus knows as host.docker.internal.
gateway=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
options=(-N -T -o BatchMode=yes -o ExitOnForwardFailure=yes
    -o ConnectTimeout=8 -o ServerAliveInterval=15 -o ServerAliveCountMax=2)

case "${1:-}" in
    gpu)
        target=lds@100.66.229.114
        options+=(-i "$HOME/.ssh/microbat" -p 2201
            -L "$gateway:19465:127.0.0.1:9465"
            -L "$gateway:18000:127.0.0.1:8000")
        ;;
    livekit)
        # The configured SSH alias points to hm@152.53.82.54.
        target=lds-server
        options+=(-L "$gateway:16789:127.0.0.1:6789")
        ;;
    *)
        printf 'Usage: %s {gpu|livekit}\n' "$0" >&2
        exit 2
        ;;
esac

while true; do
    ssh "${options[@]}" "$target" || true
    sleep 5
done
