#!/usr/bin/env bash
# Refuses to start the caption worker with an unsafe configuration.
# Usage: preflight.sh <env file> <staging|production>
set -euo pipefail

env_file=${1:?usage: preflight.sh <env file> <staging|production>}
mode=${2:?usage: preflight.sh <env file> <staging|production>}
fail() { echo "PREFLIGHT FAIL: $*" >&2; exit 1; }

[ -f "$env_file" ] || fail "no env file at $env_file"
perms=$(stat -c %a "$env_file")
[ "$perms" = 600 ] || fail "$env_file must be chmod 600 (it is $perms)"
if grep -q 'REPLACE_ME' "$env_file"; then fail "$env_file still contains REPLACE_ME placeholders"; fi

set -a
. "$env_file"
set +a

agent=${LIVEKIT_TRANSLATOR_AGENT:-}
backend_agent=${BACKEND_AGENT_NAME:-}
[ -n "$agent" ] || fail "LIVEKIT_TRANSLATOR_AGENT is unset: the worker would default to the production name"
[ -n "$backend_agent" ] || fail "BACKEND_AGENT_NAME is unset: copy LIVEKIT_TRANSLATOR_AGENT from the VM .env.production"
case "$mode" in
  staging)
    [[ "$agent" == *-staging ]] || fail "a staging agent name must end in -staging (got $agent)"
    [ "$agent" != "$backend_agent" ] || fail "staging uses the backend's production agent name"
    [ -z "${MAWIID_BACKEND_URL:-}" ] || fail "transcript saving stays off in staging: unset MAWIID_BACKEND_URL"
    ;;
  production)
    [ "$agent" = "$backend_agent" ] || fail "production must use the backend's agent name $backend_agent (got $agent)"
    [ -n "${MAWIID_BACKEND_URL:-}" ] || fail "production needs MAWIID_BACKEND_URL (the SSH tunnel)"
    [ -n "${INTERNAL_SERVICE_TOKEN:-}" ] || fail "production needs INTERNAL_SERVICE_TOKEN"
    [ "${MAWIID_AGENT_MAX_ROOMS:-0}" -gt 0 ] || fail "production needs the tested MAWIID_AGENT_MAX_ROOMS"
    [ "${MAWIID_STAGE_TIMINGS:-0}" != 1 ] || fail "MAWIID_STAGE_TIMINGS is for load tests only"
    ;;
  *) fail "mode must be staging or production" ;;
esac

[ "${CUDA_DEVICE_ORDER:-}" = PCI_BUS_ID ] || fail "CUDA_DEVICE_ORDER must be PCI_BUS_ID so indexes match nvidia-smi"
gpus=${CUDA_VISIBLE_DEVICES:-}
[ -n "$gpus" ] || fail "CUDA_VISIBLE_DEVICES is unset: every GPU, GPU 3 included, would be visible"
case ",$gpus," in *,3,*) fail "GPU 3 belongs to the Voxtral vLLM server; the worker only reaches it over loopback" ;; esac
visible=$(tr ',' '\n' <<<"$gpus" | grep -c .)
for idx in $(tr ',' ' ' <<<"${MAWIID_STT_WHISPER_DEVICE_INDEX:-0},${MAWIID_MT_DEVICE_INDEX:-0}"); do
  [ "$idx" -lt "$visible" ] || fail "device index $idx is outside CUDA_VISIBLE_DEVICES=$gpus"
done

[ "${MAWIID_STT_WHISPER_DEVICE:-}" = cuda ] || fail "MAWIID_STT_WHISPER_DEVICE must be cuda (auto can silently use the CPU)"
[ "${MAWIID_MT_DEVICE:-}" = cuda ] || fail "MAWIID_MT_DEVICE must be cuda (auto falls back to the CPU)"
[ "${MAWIID_METRICS_HOST:-127.0.0.1}" = 127.0.0.1 ] || fail "metrics must bind to 127.0.0.1; the SSH tunnel carries them"

models=${MAWIID_MODELS_DIR:-}
[ -n "$models" ] || fail "MAWIID_MODELS_DIR is unset"
[ -f "$models/madlad400-${MAWIID_MT_MODEL:-3b}-mt-ct2/model.bin" ] || fail "MADLAD ${MAWIID_MT_MODEL:-3b} is not converted in $models"
case ",${MAWIID_LANGUAGES:-ar-MA}," in
  *,ar-MA,*) [ -f "$models/whisper-darija-ct2/model.bin" ] || fail "Darija model missing in $models (ar-MA is on)" ;;
esac

ai_dir=${AI_DIR:-/workspace/mawiid/services/ai}
if [ -n "${MAWIID_STT_EXECUTOR_THREADS:-}" ]; then
  grep -q MAWIID_STT_EXECUTOR_THREADS "$ai_dir/src/mawiid_ai/agent/worker.py" \
    || fail "MAWIID_STT_EXECUTOR_THREADS is set but patch P1 is not in $ai_dir: it would be silently ignored"
fi
if [ "${MAWIID_STT_VOXTRAL_ENABLED:-0}" = 1 ]; then
  [ -f "$ai_dir/src/mawiid_ai/stt/voxtral_engine.py" ] || fail "Voxtral is enabled but patch P2 is not in $ai_dir"
  "$ai_dir/.venv/bin/python" -c "import websockets.sync.client" 2>/dev/null \
    || fail "Voxtral is enabled but websockets is missing: pip install -e '.[voxtral]'"
  url=${MAWIID_STT_VOXTRAL_URL:-ws://127.0.0.1:8000/v1/realtime}
  hostport=${url#*://}; hostport=${hostport%%/*}
  vhost=${hostport%:*}; vport=${hostport##*:}
  timeout 3 bash -c "</dev/tcp/$vhost/$vport" 2>/dev/null || fail "Voxtral is enabled but nothing listens on $vhost:$vport"
  vmodel=${MAWIID_STT_VOXTRAL_MODEL:-mistralai/Voxtral-Mini-4B-Realtime-Arabic}
  curl -fsS -m 5 "http://$vhost:$vport/v1/models" 2>/dev/null | grep -q "$vmodel" \
    || fail "the vLLM server on $vhost:$vport does not serve $vmodel"
  echo "preflight: Voxtral $vmodel answering on $vhost:$vport"
fi

if command -v nvidia-smi >/dev/null; then
  gpu3=$(nvidia-smi -i 3 --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null || echo "?")
  echo "preflight: GPU 3 memory used before start: ${gpu3} MiB (must not change after start)"
fi
echo "preflight ok: mode=$mode agent=$agent gpus=$gpus stt=${MAWIID_STT_WHISPER_DEVICE_INDEX:-0} mt=${MAWIID_MT_DEVICE_INDEX:-0} max_rooms=${MAWIID_AGENT_MAX_ROOMS:-0}"
