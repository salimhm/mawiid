#!/usr/bin/env bash
# Samples the Voxtral vLLM queue during a load test: running and waiting requests every N seconds.
#   tmux new -d -s voxtral-sampler "/workspace/mawiid-run/voxtral-sampler.sh <out dir> 5"
# waiting > 0 for long means Darija phrases queue; past 3 s they fail over to Whisper.
set -euo pipefail
out=${1:?usage: voxtral-sampler.sh <out dir> [interval seconds] [port]}
interval=${2:-5}
port=${3:-8000}
mkdir -p "$out"
[ -s "$out/voxtral.csv" ] || echo "ts,running,waiting,kv_cache_usage" >"$out/voxtral.csv"
while true; do
  metrics=$(curl -fsS -m 3 "http://127.0.0.1:$port/metrics" 2>/dev/null || true)
  row=$(awk '
    /^vllm:num_requests_running/ {r+=$NF}
    /^vllm:num_requests_waiting/ {w+=$NF}
    /^vllm:(gpu_cache_usage_perc|kv_cache_usage_perc)/ {k=$NF}
    END {printf "%s,%s,%s", r+0, w+0, k+0}' <<<"$metrics")
  echo "$(date -u +%FT%TZ),$row" >>"$out/voxtral.csv"
  sleep "$interval"
done
