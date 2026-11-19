"""Start local LiveKit for a browser on this PC and an SSH-connected GPU worker."""

from pathlib import Path
import argparse
import json
import os
import subprocess


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="livekit/livekit-server")
    parser.add_argument("--container", default="mawiid-livekit")
    parser.add_argument("--lan-ip", default="127.0.0.1")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    values = {}
    for line in (root / ".env").read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.lstrip().startswith("#"):
            values[key.strip()] = value.strip().strip('"').strip("'")
    key, secret = values.get("LIVEKIT_API_KEY"), values.get("LIVEKIT_API_SECRET")
    if not key or not secret:
        parser.error("set LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env")
    config = {
        "port": 7880,
        "bind_addresses": ["0.0.0.0"],
        "rtc": {
            "tcp_port": 7881,
            "udp_port": 7882,
            "use_external_ip": False,
            "node_ip": "127.0.0.1",
            "advertise_internal_ip": True,
            "enable_loopback_candidate": True,
            "ips": {"includes": list(dict.fromkeys(["127.0.0.1/32", args.lan_ip + "/32"]))},
        },
        "keys": {key: secret},
        "webhook": {"api_key": key, "urls": ["http://127.0.0.1:3000/webhook/livekit"]},
        "logging": {"level": "info"},
    }
    directory = root / ".secrets"
    directory.mkdir(mode=0o700, exist_ok=True)
    path = directory / "livekit.local-gpu.yaml"
    # JSON is valid YAML. Never put the API secret in a tracked config or command.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump(config, output, indent=2)
    path.chmod(0o600)
    subprocess.run(["docker", "rm", "-f", args.container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run([
        "docker", "run", "-d", "--name", args.container, "--network", "host",
        "-v", f"{path}:/etc/livekit.yaml:ro", args.image,
        "--config", "/etc/livekit.yaml", "--bind", "0.0.0.0",
    ], check=True, stdout=subprocess.DEVNULL)
    print("Local LiveKit: http://localhost:7880 (GPU worker media over the private SSH link)")


if __name__ == "__main__":
    main()
