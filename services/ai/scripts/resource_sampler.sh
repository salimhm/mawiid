#!/usr/bin/env bash
# Samples what the deployment consumes while a load test runs, for the cost audit.
# Run it on the server (the DGX), next to docker compose, for as long as the test:
#
#   scripts/resource_sampler.sh data/loadtest/5x1 5      # every 5 s until Ctrl-C
#
# Writes into the directory:
#   gpu.csv        per GPU: utilisation, memory, power draw, temperature
#   containers.csv per container: CPU %, memory, network and block I/O
#   host.csv       load average, memory used, and the CPU busy share since the last sample
set -euo pipefail

out=${1:?usage: resource_sampler.sh <out dir> [interval seconds]}
interval=${2:-5}
mkdir -p "$out"

if command -v nvidia-smi >/dev/null; then
  [ -s "$out/gpu.csv" ] || echo "ts,gpu,util_pct,mem_used_mib,mem_total_mib,power_w,temp_c" >"$out/gpu.csv"
fi
[ -s "$out/containers.csv" ] || echo "ts,container,cpu_pct,mem_usage,mem_pct,net_io,block_io" >"$out/containers.csv"
[ -s "$out/host.csv" ] || echo "ts,load1,mem_used_mib,mem_total_mib,cpu_busy_pct" >"$out/host.csv"

read -r _ u n s i w x y z _ </proc/stat; prev_busy=$((u + n + s + x + y + z)); prev_total=$((prev_busy + i + w))
echo "sampling every ${interval}s into $out (Ctrl-C to stop)"
while true; do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if command -v nvidia-smi >/dev/null; then
    nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total,power.draw,temperature.gpu \
      --format=csv,noheader,nounits | sed "s/ //g; s/^/$ts,/" >>"$out/gpu.csv"
  fi
  docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}' 2>/dev/null \
    | sed "s/ //g; s/^/$ts,/" >>"$out/containers.csv" || true
  read -r _ u n s i w x y z _ </proc/stat; busy=$((u + n + s + x + y + z)); total=$((busy + i + w))
  cpu=$(( total > prev_total ? 100 * (busy - prev_busy) / (total - prev_total) : 0 )); prev_busy=$busy; prev_total=$total
  mem=$(free -m | awk '/^Mem:/ {print $3","$2}')
  echo "$ts,$(cut -d' ' -f1 /proc/loadavg),$mem,$cpu" >>"$out/host.csv"
  sleep "$interval"
done
