#!/usr/bin/env python3
"""How many model workers sit on each GPU, for the Mawiid caption worker and the Voxtral server.

CTranslate2 workers are threads inside one process, so nvidia-smi shows a single process per GPU
whatever the worker count. This script works it out from the settings the process really started
with (its environment), using the same defaults as services/ai, then shows what nvidia-smi sees.

    python3 gpu-workers.py                      # the running caption worker (found automatically)
    python3 gpu-workers.py --pid 12345          # a specific process
    python3 gpu-workers.py --env staging.env    # no worker running yet: read an env file instead
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

DEFAULT_LANGUAGES = "en-US,fr-FR,ar-SA,ar-MA"


def pids_matching(pattern: str) -> list[int]:
    found = []
    for proc in Path("/proc").glob("[0-9]*"):
        try:
            cmd = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        except OSError:
            continue
        if pattern in cmd and "gpu-workers.py" not in cmd:
            found.append(int(proc.name))
    return sorted(found)


def read_environ(pid: int) -> dict[str, str]:
    try:
        raw = Path(f"/proc/{pid}/environ").read_bytes()
    except PermissionError:
        sys.exit(f"cannot read /proc/{pid}/environ: run as the same user as the process (or with sudo)")
    pairs = (item.split(b"=", 1) for item in raw.split(b"\0") if b"=" in item)
    return {k.decode(errors="replace"): v.decode(errors="replace") for k, v in pairs}


def read_env_file(path: str) -> dict[str, str]:
    env = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def ints(value: str) -> list[int]:
    return [int(part) for part in value.split(",") if part.strip()]


def gpu_count() -> int | None:
    if not shutil.which("nvidia-smi"):
        return None
    out = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True).stdout
    return len([line for line in out.splitlines() if line.startswith("GPU ")]) or None


def physical(env: dict[str, str], logical: int) -> str:
    """Map a CUDA index inside the process to the nvidia-smi GPU number."""
    visible = env.get("CUDA_VISIBLE_DEVICES")
    if visible is None or visible.strip() == "":
        return str(logical)
    ids = [part.strip() for part in visible.split(",") if part.strip()]
    return ids[logical] if logical < len(ids) else f"INVALID(index {logical} not in CUDA_VISIBLE_DEVICES={visible})"


def caption_worker(env: dict[str, str], per_gpu: dict[str, list[str]], notes: list[str]) -> None:
    smi_gpus = gpu_count()
    stt_device = env.get("MAWIID_STT_WHISPER_DEVICE", "auto")
    mt_device = env.get("MAWIID_MT_DEVICE", "auto")
    stt_index = ints(env.get("MAWIID_STT_WHISPER_DEVICE_INDEX", "0")) or [0]
    workers = max(1, int(env.get("MAWIID_STT_WHISPER_NUM_WORKERS", "1") or 1))
    instances = int(env.get("MAWIID_STT_INSTANCES", "0") or 0) or 1
    model = env.get("MAWIID_STT_WHISPER_MODEL", "small")
    languages = env.get("MAWIID_LANGUAGES", DEFAULT_LANGUAGES)
    darija = "ar-MA" in languages
    mt_index = ints(env.get("MAWIID_MT_DEVICE_INDEX", "0")) or [0]
    inter = max(1, int(env.get("MAWIID_MT_INTER_THREADS", "1") or 1))
    mt_model = env.get("MAWIID_MT_MODEL", "3b") or "3b"
    threads = env.get("MAWIID_STT_EXECUTOR_THREADS") or "8"

    if stt_device == "cpu":
        notes.append("Whisper runs on the CPU (MAWIID_STT_WHISPER_DEVICE=cpu): no Whisper workers on any GPU.")
    else:
        if stt_device == "auto":
            notes.append("MAWIID_STT_WHISPER_DEVICE=auto: counted as GPU; it falls back to CPU if no GPU is usable.")
        for logical in stt_index:
            gpu = physical(env, logical)
            per_gpu[gpu].append(f"Whisper {model}: {workers * instances} worker(s)"
                                f" ({workers} per copy x {instances} copy)")
            if darija:
                per_gpu[gpu].append(f"Darija Whisper: {workers * instances} worker(s)"
                                    " (loaded only if the Darija model exists)")
    if mt_device == "cpu":
        notes.append("MADLAD runs on the CPU (MAWIID_MT_DEVICE=cpu): no translation workers on any GPU.")
    else:
        if mt_device == "auto":
            notes.append("MAWIID_MT_DEVICE=auto: counted as GPU; it silently falls back to CPU if the GPU load fails.")
        for logical in mt_index:
            per_gpu[physical(env, logical)].append(f"MADLAD {mt_model}: {inter} worker(s)")
    notes.append(f"Executor threads (speakers in flight, all rooms): {int(threads) * instances}"
                 f" = {threads} x {instances} copy" + ("" if "MAWIID_STT_EXECUTOR_THREADS" in env else " (default 8; patch P1 makes it configurable)"))
    if env.get("MAWIID_STT_VOXTRAL_ENABLED") == "1":
        notes.append(f"Voxtral enabled for Darija: worker connects to {env.get('MAWIID_STT_VOXTRAL_URL', 'ws://127.0.0.1:8000/v1/realtime')}")
    if smi_gpus is None:
        notes.append("nvidia-smi not found here: GPU numbers assume CUDA_VISIBLE_DEVICES is right.")


def voxtral_servers(per_gpu: dict[str, list[str]]) -> None:
    for pid in pids_matching("vllm serve"):
        cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        if " serve " not in f" {cmd} ":
            continue
        try:
            env = read_environ(pid)
        except SystemExit:
            env = {}
        seqs = re.search(r"--max-num-seqs[ =](\d+)", cmd)
        util = re.search(r"--gpu-memory-utilization[ =]([\d.]+)", cmd)
        model = re.search(r"serve\s+(\S+)", cmd)
        visible = env.get("CUDA_VISIBLE_DEVICES", "?")
        for gpu in [g.strip() for g in visible.split(",") if g.strip()] or ["?"]:
            per_gpu[gpu].append(
                f"vLLM pid {pid} {model.group(1) if model else ''}: up to "
                f"{seqs.group(1) if seqs else 'vLLM default'} concurrent sequences"
                f" (gpu-memory-utilization {util.group(1) if util else 'default'})")


def nvidia_view() -> None:
    if not shutil.which("nvidia-smi"):
        return
    gpus = subprocess.run(["nvidia-smi", "--query-gpu=index,pci.bus_id,memory.used,memory.total,utilization.gpu",
                           "--format=csv,noheader"], capture_output=True, text=True).stdout.strip().splitlines()
    apps = subprocess.run(["nvidia-smi", "--query-compute-apps=gpu_bus_id,pid,process_name,used_memory",
                           "--format=csv,noheader"], capture_output=True, text=True).stdout.strip().splitlines()
    print("\nWhat nvidia-smi sees (one line per process, not per worker):")
    for gpu in gpus:
        index, bus, used, total, util = [part.strip() for part in gpu.split(",")]
        print(f"  GPU {index}: {used} / {total} used, {util} busy")
        for app in apps:
            app_bus, pid, name, mem = [part.strip() for part in app.split(",")]
            if app_bus.lower().endswith(bus.lower()[-12:]):
                print(f"      pid {pid:>7}  {mem:>10}  {name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pid", type=int, help="caption worker process id (default: found automatically)")
    parser.add_argument("--env", help="read settings from this env file instead of a running process")
    args = parser.parse_args()

    if args.env:
        env, source = read_env_file(args.env), f"env file {args.env}"
    else:
        pid = args.pid or next(iter(pids_matching("mawiid_ai.agent")), None)
        if pid is None:
            print("No caption worker is running. Use --env <file> to read its settings instead.")
            env, source = None, None
        else:
            env, source = read_environ(pid), f"running caption worker pid {pid}"

    per_gpu: dict[str, list[str]] = defaultdict(list)
    notes: list[str] = []
    if env is not None:
        caption_worker(env, per_gpu, notes)
    voxtral_servers(per_gpu)

    if source:
        print(f"Settings read from: {source}")
    print("\nWorkers per GPU (nvidia-smi numbering):")
    count = gpu_count()
    gpus = sorted(set(per_gpu) | {str(i) for i in range(count or 0)}, key=lambda g: (not g.isdigit(), g.zfill(4)))
    for gpu in gpus:
        lines = per_gpu.get(gpu, [])
        print(f"  GPU {gpu}:" + ("" if lines else " nothing from Mawiid"))
        for line in lines:
            print(f"      {line}")
    for note in notes:
        print(f"  note: {note}")
    nvidia_view()
    return 0


if __name__ == "__main__":
    sys.exit(main())
