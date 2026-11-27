#!/usr/bin/env bash
# Runs the caption worker and restarts it whenever it exits. Start it inside tmux:
#   tmux new -d -s caption-worker '/workspace/mawiid-run/run-worker.sh /workspace/mawiid-run/env/staging.env staging'
# Stop it:  tmux kill-session -t caption-worker
set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
env_file=${1:?usage: run-worker.sh <env file> <staging|production>}
mode=${2:?usage: run-worker.sh <env file> <staging|production>}
ai_dir=${AI_DIR:-/workspace/mawiid/services/ai}
log_dir=$here/logs

if pgrep -f "mawiid_ai.agent start" >/dev/null; then
  echo "a caption worker is already running in this container; stop it first" >&2
  exit 1
fi
"$here/preflight.sh" "$env_file" "$mode"

set -a
. "$env_file"
set +a
mkdir -p "$log_dir"
cd "$ai_dir"

while true; do
  echo "$(date -u +%FT%TZ) start mode=$mode agent=$LIVEKIT_TRANSLATOR_AGENT gpus=$CUDA_VISIBLE_DEVICES" >>"$log_dir/supervisor.log"
  rc=0
  scripts/run-with-cuda.sh .venv/bin/python -m mawiid_ai.agent start || rc=$?
  echo "$(date -u +%FT%TZ) worker exited with code $rc; restarting in 5 s" >>"$log_dir/supervisor.log"
  sleep 5
done
