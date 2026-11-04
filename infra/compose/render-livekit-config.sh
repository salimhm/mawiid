#!/bin/sh
set -eu

: "${LIVEKIT_API_KEY:?Set LIVEKIT_API_KEY in .env.production}"
: "${LIVEKIT_API_SECRET:?Set LIVEKIT_API_SECRET in .env.production}"

umask 077
mkdir -p runtime
envsubst '${LIVEKIT_API_KEY} ${LIVEKIT_API_SECRET}' < livekit.yaml.template > runtime/livekit.yaml
echo "Rendered runtime/livekit.yaml"
