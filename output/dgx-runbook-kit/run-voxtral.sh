#!/usr/bin/env bash
# Runs the Voxtral Realtime vLLM server on GPU 3 and restarts it whenever it exits.
# Use it only after Phase 1.3 has recorded how the current server was started, and only in an
# agreed window: replacing a running server briefly sends Darija captions to Whisper.
#   tmux new -d -s voxtral /workspace/mawiid-run/run-voxtral.sh
# Settings come from env/voxtral.conf (copy voxtral.conf.example).
set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$here/env/voxtral.conf"
: "${VOXTRAL_VENV:?set VOXTRAL_VENV in env/voxtral.conf}"
mkdir -p "$here/logs"

if pgrep -f "vllm serve" >/dev/null; then
  echo "a vLLM server is already running; stop it first (Phase 1.3 recorded how it was started)" >&2
  exit 1
fi

export CUDA_DEVICE_ORDER=PCI_BUS_ID
export CUDA_VISIBLE_DEVICES=${VOXTRAL_GPU:-3}
export HF_HOME=${HF_HOME:-$here/hf-cache}

while true; do
  echo "$(date -u +%FT%TZ) start vllm on GPU $CUDA_VISIBLE_DEVICES util=${VOXTRAL_GPU_MEMORY_UTILIZATION:-0.45} seqs=${VOXTRAL_MAX_NUM_SEQS:-8}" >>"$here/logs/voxtral-supervisor.log"
  rc=0
  "$VOXTRAL_VENV/bin/vllm" serve "${VOXTRAL_MODEL:-mistralai/Voxtral-Mini-4B-Realtime-Arabic}" \
    --revision "${VOXTRAL_REVISION:-7c60cf2acb1ceb823efe937ddbc88e5e7b6e7dc2}" \
    --host 127.0.0.1 --port "${VOXTRAL_PORT:-8000}" \
    --tokenizer-mode mistral --config-format mistral --load-format mistral --enforce-eager \
    --gpu-memory-utilization "${VOXTRAL_GPU_MEMORY_UTILIZATION:-0.45}" \
    --max-model-len "${VOXTRAL_MAX_MODEL_LEN:-4096}" \
    --max-num-seqs "${VOXTRAL_MAX_NUM_SEQS:-8}" \
    >>"$here/logs/voxtral.log" 2>&1 || rc=$?
  echo "$(date -u +%FT%TZ) vllm exited with code $rc; restarting in 10 s" >>"$here/logs/voxtral-supervisor.log"
  sleep 10
done
