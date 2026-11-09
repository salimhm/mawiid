#!/usr/bin/env bash
set -euo pipefail

ai_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ai_library_path=""

for ai_library_directory in "$ai_directory"/.venv/lib/python*/site-packages/nvidia/*/lib; do
  if [[ -d "$ai_library_directory" ]]; then
    ai_library_path="${ai_library_path:+$ai_library_path:}$ai_library_directory"
  fi
done

if [[ -n "$ai_library_path" ]]; then
  export LD_LIBRARY_PATH="$ai_library_path${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

exec "$@"
