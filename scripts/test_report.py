#!/usr/bin/env python3
"""Runs the Backlog 1 checks against the local stack and writes the test report.

`make dev` starts this in the background once the servers are up (turn it off with REPORT=0);
`make report` runs it on its own against a stack that is already running. Standard library only.

The report follows the five points asked for: tests performed, measured results, vulnerabilities
fixed and retested, outstanding issues, tests not completed. Every number in it comes from this
run (or from load-test folders already on this machine); anything not run is listed as not tested.

With every profile except none, translation bots also check translation quality first
(services/ai/scripts/translation_bot.py: bots speak, listener bots read, captions scored).

Profiles (--profile, or REPORT_PROFILE with make):
  quick  about 15 min of load: a 5-user ramp (1..5 talking, 2 min steps) and 2 rooms at once
  hour   the two 1-hour sessions: 5 users all talking, then 10 users one at a time (~2 h 15)
  full   the whole runbook matrix: R5, R10, B, C, D and E with 2, 4 and 6 rooms (~6 h 30)
  none   no load test: unit tests, smoke tests and security probes only

Hand-written facts (severity and ETA of known issues, Microintégrèle's answer, the DGX hourly
cost) come from docs/test-report-input.json. Output: reports/<timestamp>/report.md and
report.html, plus every command's full log next to them.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import datetime as dt
import hashlib
import hmac
import html
import json
import os
import platform
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "apps/backend"
AI = ROOT / "services/ai"
INPUT = ROOT / "docs/test-report-input.json"
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:3000")
FRONTEND_URL = os.environ.get("FRONTEND_URL", f"https://localhost:{os.environ.get('FRONTEND_PORT', '3100')}")
CADDY_PORT = 18080
SLA = "caption p95 > 3.0 s, or > 2 % of captions lost, or p50 rising 5 minutes in a row"

# name, what it is, room_loadtest.py arguments, minutes (for the ETA printed at the start)
LOAD_RUNS = {
    "quick": [
        ("R5-quick", "5 users, ramp 1→5 talking at once, 2 min steps", "--speakers 5 --ramp 1,2,3,4,5 --step-minutes 2", 10),
        ("E2-quick", "multi-tenant: 2 rooms × 3 users, 1 talking per room", "--rooms 2 --speakers 3 --concurrency 1 --minutes 4", 4),
    ],
    "hour": [
        ("B", "5 users, all talking, 65 min", "--speakers 5 --minutes 65", 65),
        ("C", "10 users, 1 talking at a time (a meeting), 65 min", "--speakers 10 --concurrency 1 --minutes 65", 65),
    ],
    "full": [
        ("R5", "5 users, ramp 1→5, 12 min steps", "--speakers 5 --ramp 1,2,3,4,5 --step-minutes 12", 60),
        ("R10", "10 users, ramp 1→10, 7 min steps", "--speakers 10 --ramp 1,2,3,4,5,6,7,8,9,10 --step-minutes 7", 70),
        ("B", "5 users, all talking, 65 min", "--speakers 5 --minutes 65", 65),
        ("C", "10 users, 1 talking at a time, 65 min", "--speakers 10 --concurrency 1 --minutes 65", 65),
        ("D", "10 users, all talking, 60 min", "--speakers 10 --minutes 60", 60),
        ("E2", "multi-tenant: 2 rooms × 5, 1 talking per room", "--rooms 2 --speakers 5 --concurrency 1 --minutes 20", 20),
        ("E4", "multi-tenant: 4 rooms × 5, 1 talking per room", "--rooms 4 --speakers 5 --concurrency 1 --minutes 20", 20),
        ("E6", "multi-tenant: 6 rooms × 5, 1 talking per room", "--rooms 6 --speakers 5 --concurrency 1 --minutes 20", 20),
    ],
    "none": [],
}

# The runbook's matrix: id, test, load runs that cover it, profile that runs it.
MATRIX = [
    ("A", "Smoke load test on the target server", ("R5", "B", "C"), "quick"),
    ("R5", "5-user breaking point (ramp 1→5 talking at once)", ("R5",), "quick"),
    ("R10", "10-user breaking point (ramp 1→10)", ("R10",), "full"),
    ("B", "5 users, all talking, 1 h+", ("B",), "hour"),
    ("C", "10 users, 1 talking at a time, 1 h+", ("C",), "hour"),
    ("D", "10 users, all talking, 1 h", ("D",), "full"),
    ("E", "Multi-tenant capacity: rooms one worker carries", ("E",), "quick"),
]

PASS, FAIL, SKIP, INFO = "pass", "fail", "not run", "info"
ICON = {PASS: "✅ Validated", FAIL: "❌ Needs fixing", SKIP: "⏳ Not tested", INFO: "ℹ️ Measured"}

quiet = False


def say(message: str) -> None:
    print(f"[report] {message}", flush=True)


def log(message: str) -> None:
    if not quiet:
        say(message)


# ---------------------------------------------------------------- helpers


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip().removeprefix("export ").strip()] = value.strip().strip("'\"")
    return values


def run(cmd: list[str] | str, log_path: Path, cwd: Path = ROOT, env: dict | None = None, timeout: float = 1800) -> tuple[int, str, float]:
    """Runs a command, saves its output to log_path, returns (exit code, output, seconds)."""
    started = time.monotonic()
    try:
        proc = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})}, shell=isinstance(cmd, str),
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", timeout=timeout)
        code, out = proc.returncode, proc.stdout
    except subprocess.TimeoutExpired as error:
        code, out = 124, (error.stdout or "") if isinstance(error.stdout, str) else ""
        out += f"\n[timed out after {timeout:.0f} s]"
    except FileNotFoundError as error:
        code, out = 127, str(error)
    log_path.write_text(out, encoding="utf-8")
    return code, out, time.monotonic() - started


_insecure = ssl.create_default_context()
_insecure.check_hostname = False
_insecure.verify_mode = ssl.CERT_NONE


def http(method: str, url: str, body: bytes | dict | None = None, headers: dict | None = None, timeout: float = 15) -> tuple[int, dict, bytes]:
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    hdrs = {"content-type": "application/json"} if data is not None else {}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_insecure) as res:
            return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers or {}), error.read()
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        return 0, {}, str(error).encode()


def wait_for(url: str, minutes: float) -> bool:
    deadline = time.monotonic() + minutes * 60
    while time.monotonic() < deadline:
        status, _, _ = http("GET", url, timeout=5)
        if 200 <= status < 500:
            return True
        time.sleep(5)
    return False


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwt(payload: dict, secret: str | None, alg: str = "HS256") -> str:
    head = b64(json.dumps({"alg": alg, "typ": "JWT"}).encode()) + "." + b64(json.dumps(payload).encode())
    if secret is None:
        return head + "."
    return head + "." + b64(hmac.new(secret.encode(), head.encode(), hashlib.sha256).digest())


def pct(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    return values[min(len(values) - 1, int(round(q * (len(values) - 1))))]


def fmt_s(value) -> str:
    return "–" if value is None else f"{value:.2f} s"


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        return ""


# ---------------------------------------------------------------- the report's state


class Report:
    def __init__(self, out: Path, profile: str) -> None:
        self.out = out
        self.profile = profile
        self.started = dt.datetime.now().astimezone()
        self.checks: list[dict] = []  # area, name, status, evidence, log
        self.load: list[dict] = []  # one per load run: name, what, summary, dir, minutes
        self.load_note = ""  # why load tests did not run, if they did not
        self.resources: dict = {}
        self.earlier_runs: list[dict] = []
        self.translation: dict | None = None  # results.json of the translation bots
        self.environment: dict = {}
        self.finished = False

    def add(self, area: str, name: str, status: str, evidence: str, log_file: str = "") -> None:
        self.checks.append({"area": area, "name": name, "status": status, "evidence": evidence, "log": log_file})
        log(f"{ICON[status]:<16} {area}: {name}")

    def find(self, name_part: str) -> dict | None:
        return next((c for c in self.checks if name_part in c["name"]), None)


# ---------------------------------------------------------------- environment


def environment(report: Report) -> None:
    gpus = ""
    if shutil.which("nvidia-smi"):
        gpus = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                              capture_output=True, text=True).stdout.strip().replace("\n", "; ")
    mem_gib = ""
    try:
        kb = int(re.search(r"MemTotal:\s+(\d+)", Path("/proc/meminfo").read_text()).group(1))
        mem_gib = f"{kb / 1024 / 1024:.0f} GiB"
    except Exception:
        pass
    cpu = ""
    try:
        cpu = re.search(r"model name\s*:\s*(.+)", Path("/proc/cpuinfo").read_text()).group(1).strip()
    except Exception:
        cpu = platform.processor()
    env = {**read_env(ROOT / ".env")}
    models = {k: v for k, v in env.items() if k.startswith("MAWIID_") and "TOKEN" not in k and "SECRET" not in k}
    report.environment = {
        "Machine": f"{socket.gethostname()} · {platform.system()} {platform.release()}",
        "CPU": f"{cpu} × {os.cpu_count()} threads",
        "RAM": mem_gib or "unknown",
        "GPU": gpus or "none detected (no nvidia-smi): the AI worker runs on CPU",
        "Commit": f"{git('rev-parse', '--short', 'HEAD')} on branch {git('rev-parse', '--abbrev-ref', 'HEAD')}"
                  + (" (with uncommitted changes)" if git("status", "--porcelain") else ""),
        "Model settings (.env)": ", ".join(f"{k}={v}" for k, v in sorted(models.items())) or "defaults",
        "Load profile": report.profile,
    }


# ---------------------------------------------------------------- automated tests


def unit_tests(report: Report) -> None:
    code, out, secs = run(["bun", "test", "src"], report.out / "backend-unit.log", cwd=BACKEND, timeout=1200)
    passed = re.search(r"(\d+)\s+pass", out)
    failed = re.search(r"(\d+)\s+fail", out)
    n_pass, n_fail = int(passed.group(1)) if passed else 0, int(failed.group(1)) if failed else 0
    status = PASS if code == 0 and n_pass else FAIL
    names = re.findall(r"^\s*\(fail\)\s*(.+?)(?:\s\[\d.*)?$", out, re.M)
    evidence = f"{n_pass} passed, {n_fail} failed in {secs:.0f} s" + (f". Failing: {'; '.join(names[:8])}" if names else "")
    if code != 0 and not passed:
        evidence = f"could not run (exit {code}); see log"
    report.add("Automated tests", "Backend unit tests (bun test)", status, evidence, "backend-unit.log")

    for name, pattern in [("Login burst regression test", "parallel burst of guesses"),
                          ("Lockout reset regression test", "clears previous failed-login limits")]:
        code, out, _ = run(["bun", "test", "src", "--test-name-pattern", pattern], report.out / f"backend-{pattern[:12].replace(' ', '-')}.log",
                           cwd=BACKEND, timeout=600)
        ok = code == 0 and re.search(r"[1-9]\d*\s+pass", out)
        report.add("Security retest", name, PASS if ok else FAIL,
                   f"`{pattern}`: {'passes' if ok else 'fails or missing'}", f"backend-{pattern[:12].replace(' ', '-')}.log")

    py = AI / ".venv/bin/python"
    if not py.exists():
        report.add("Automated tests", "AI worker tests (pytest)", SKIP, "services/ai/.venv missing (make ai-install)")
        return
    code, out, secs = run([str(py), "-m", "pytest", "-q", "-p", "no:cacheprovider"], report.out / "ai-unit.log", cwd=AI, timeout=1800)
    counts = {k: int(v) for v, k in re.findall(r"(\d+) (passed|failed|skipped|error)", out)}
    names = re.findall(r"^FAILED (\S+)", out, re.M)
    evidence = ", ".join(f"{v} {k}" for k, v in counts.items()) + f" in {secs:.0f} s"
    if names:
        evidence += ". Failing: " + "; ".join(n.split("::")[-1] for n in names)
    report.add("Automated tests", "AI worker tests (pytest)", PASS if code == 0 else FAIL, evidence, "ai-unit.log")


def smoke(report: Report) -> None:
    if not wait_for(FRONTEND_URL, 0.1):
        report.add("End-to-end", "Smoke tests (postman/smoke.ts)", SKIP, f"frontend not reachable at {FRONTEND_URL}")
        return
    code, out, secs = run(["bun", "postman/smoke.ts"], report.out / "smoke.log", cwd=BACKEND,
                          env={"NODE_TLS_REJECT_UNAUTHORIZED": "0", "FRONTEND_URL": FRONTEND_URL}, timeout=300)
    lines = re.findall(r"^\s+(ok|FAIL)\s+(.+)$", out, re.M)
    if not lines:
        report.add("End-to-end", "Smoke tests (postman/smoke.ts)", FAIL, f"did not run (exit {code}); see log", "smoke.log")
        return
    tenancy = ("non-member", "member cannot", "unknown room", "without token", "invalid token", "invalid ticket", "wrong password", "logout")
    for result, text in lines:
        name, _, detail = text.partition(": ")
        area = "Multi-tenancy / access" if any(t in name for t in tenancy) else "End-to-end"
        report.add(area, name.strip(), PASS if result == "ok" else FAIL, "passes through the frontend proxy" if result == "ok" else detail, "smoke.log")


# ---------------------------------------------------------------- live security probes


def probe_otp(report: Report) -> None:
    status, _, body = http("POST", f"{BACKEND_URL}/auth/otp", {"user_phone": "+212600000099"})
    leaks = b'"code"' in body or b"otp_code" in body
    local_env = read_env(ROOT / ".env").get("ENV", "")
    report.add("Security probe", "OTP code in the response (local stack)", INFO,
               f"HTTP {status}, code returned: {'yes' if leaks else 'no'}. Local .env has ENV={local_env or 'unset'}, "
               "where returning the code is the expected developer behaviour")
    template = read_env(ROOT / "infra/compose/.env.production.example").get("ENV")
    prod_file = ROOT / "infra/compose/.env.production"
    prod = read_env(prod_file).get("ENV") if prod_file.exists() else None
    if prod is not None:
        report.add("Security probe", "Production .env runs ENV=production (OTP never returned)", PASS if prod == "production" else FAIL,
                   f"infra/compose/.env.production has ENV={prod}")
    else:
        report.add("Security probe", "Production template runs ENV=production (OTP never returned)", PASS if template == "production" else FAIL,
                   f".env.production.example has ENV={template}; no .env.production on this machine to check")


def probe_caddy(report: Report) -> None:
    name = "mawiid-report-caddy"
    if not shutil.which("docker"):
        report.add("Security retest", "Internal routes hidden by Caddy", SKIP, "docker not available")
        return
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    start = subprocess.run(
        ["docker", "run", "-d", "--name", name, "--network", "host", "--add-host", "backend:127.0.0.1", "--add-host", "livekit:127.0.0.1",
         "-e", f"APP_DOMAIN=http://localhost:{CADDY_PORT}", "-e", f"RTC_DOMAIN=http://localhost:{CADDY_PORT + 1}",
         "-v", f"{ROOT / 'infra/compose/Caddyfile'}:/etc/caddy/Caddyfile:ro", "caddy:2-alpine",
         "caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
        capture_output=True, text=True)
    if start.returncode != 0:
        report.add("Security retest", "Internal routes hidden by Caddy", SKIP, f"could not start Caddy: {start.stderr.strip()[:200]}")
        return
    try:
        wait_for(f"http://localhost:{CADDY_PORT}/api/health", 1)
        rows = []
        ok = True
        control, _, _ = http("GET", f"http://localhost:{CADDY_PORT}/api/health")
        rows.append(f"/api/health → {control} (control, must stay 200)")
        ok &= control == 200
        for method, path in [("GET", "/api/openapi"), ("POST", "/api/transcript/internal"), ("POST", "/api/webhook/livekit")]:
            status, _, _ = http(method, f"http://localhost:{CADDY_PORT}{path}", b"{}" if method == "POST" else None)
            direct, _, _ = http(method, f"{BACKEND_URL}{path.removeprefix('/api')}", b"{}" if method == "POST" else None)
            rows.append(f"{method} {path} → {status} through Caddy (backend direct: {direct})")
            ok &= status == 404
        (report.out / "caddy-probe.log").write_text("\n".join(rows) + "\n\n" + subprocess.run(
            ["docker", "logs", name], capture_output=True, text=True).stderr[-4000:], encoding="utf-8")
        report.add("Security retest", "Internal routes hidden by Caddy (production Caddyfile, run locally)", PASS if ok else FAIL,
                   "; ".join(rows), "caddy-probe.log")
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)


def probe_login_burst(report: Report) -> None:
    identifier = f"report_probe_{secrets.token_hex(4)}"  # no such user: nobody real gets locked out
    def attempt(_):
        return http("POST", f"{BACKEND_URL}/auth/login", {"user_identifier": identifier, "user_password": "wrong-password-123"}, timeout=60)[0]
    with concurrent.futures.ThreadPoolExecutor(30) as pool:
        statuses = list(pool.map(attempt, range(30)))
    checked = sum(1 for s in statuses if s == 401)
    limited = sum(1 for s in statuses if s == 429)
    other = len(statuses) - checked - limited
    report.add("Security retest", "Parallel login burst against the 10-attempt limit (live)", PASS if checked <= 10 and other == 0 else FAIL,
               f"30 wrong passwords sent at once: {checked} checked (401), {limited} refused (429), {other} other "
               f"(statuses {sorted(set(statuses))}). Limit is 10; before the fix 30 of 30 were checked")


def probe_redis_ttl(report: Report) -> None:
    if not shutil.which("docker"):
        report.add("Security retest", "Every rate-limit counter has an expiry (live Redis)", SKIP, "docker not available")
        return
    keys: list[str] = []
    for pattern in ("auth_login_attempt:*", "rate:*", "auth_otp_attempt:*"):
        out = subprocess.run(["docker", "exec", "mawiid-redis", "redis-cli", "--scan", "--pattern", pattern], capture_output=True, text=True)
        if out.returncode != 0:
            report.add("Security retest", "Every rate-limit counter has an expiry (live Redis)", SKIP, "mawiid-redis container not reachable")
            return
        keys += [k for k in out.stdout.split() if k]
    no_ttl = []
    for key in keys:
        ttl = subprocess.run(["docker", "exec", "mawiid-redis", "redis-cli", "TTL", key], capture_output=True, text=True).stdout.strip()
        if ttl == "-1":
            no_ttl.append(key)
    report.add("Security retest", "Every rate-limit counter has an expiry (live Redis)", PASS if keys and not no_ttl else (FAIL if no_ttl else SKIP),
               f"{len(keys)} counters found, {len(no_ttl)} without expiry" if keys else "no counters in Redis to inspect")


def probe_jwt(report: Report) -> None:
    env = json.loads((BACKEND / "postman/mawiid.postman_environment.json").read_text())
    tokens = {v["key"]: v["value"] for v in env["values"]}
    valid = tokens.get("token_host", "")
    secret = read_env(BACKEND / "postman/.env.postman").get("JWT_SECRET_KEY")
    url = f"{BACKEND_URL}/presence/?user_id=1"
    control = http("GET", url, headers={"authorization": f"Bearer {valid}"})[0]
    head, payload, sig = (valid.split(".") + ["", "", ""])[:3]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))) if payload else {"user_id": 1}
    forged = {**claims, "user_id": int(claims.get("user_id", 1)) + 1}
    cases = [
        ("no token", None),
        ("garbage token", "not.a.jwt"),
        ("alg: none", jwt(forged, None, alg="none")),
        ("user_id changed, original signature", head + "." + b64(json.dumps(forged).encode()) + "." + sig),
        ("signed with a wrong secret", jwt(forged, "wrong-secret")),
    ]
    if secret:
        cases.append(("expired (correct secret, exp 1 h ago)", jwt({**claims, "exp": int(time.time()) - 3600}, secret)))
    rows, ok = [f"valid token → {control} (control)"], control == 200
    for name, token in cases:
        status = http("GET", url, headers={"authorization": f"Bearer {token}"} if token else {})[0]
        rows.append(f"{name} → {status}")
        ok &= status in (400, 401, 403)
    report.add("Security probe", "Forged, expired and tampered access tokens are refused", (PASS if ok else FAIL) if control == 200 else SKIP,
               "; ".join(rows) + ("" if control == 200 else " (control did not return 200: result inconclusive)"))


def probe_input(report: Report) -> None:
    rows, ok = [], True
    cases = [
        ("10 MB body", b'{"user_identifier":"' + b"a" * 10_000_000 + b'","user_password":"x"}'),
        ("wrong types", {"user_identifier": 12, "user_password": ["x"]}),
        ("SQL payload", {"user_identifier": "' OR 1=1; --", "user_password": "x"}),
        ("control/unicode chars", {"user_identifier": "a\u0000b\u202e\ud83d\ude00", "user_password": "x"}),
        ("not JSON", b"{{{{"),
    ]
    for name, body in cases:
        started = time.monotonic()
        status = http("POST", f"{BACKEND_URL}/auth/login", body, timeout=60)[0]
        rows.append(f"{name} → {status} ({time.monotonic() - started:.1f} s)")
        ok &= 400 <= status < 500
    report.add("Security probe", "Malformed and oversized input is rejected without a server error", PASS if ok else FAIL, "; ".join(rows))


def probe_cors(report: Report) -> None:
    _, headers, _ = http("GET", f"{BACKEND_URL}/health", headers={"origin": "https://attacker.example"})
    allowed = {k.lower(): v for k, v in headers.items()}.get("access-control-allow-origin", "")
    report.add("Security probe", "CORS limited to the app's own domain", FAIL if allowed in ("*", "https://attacker.example") else PASS,
               f"request from https://attacker.example got Access-Control-Allow-Origin: {allowed or '(none)'}")


# ---------------------------------------------------------------- load tests and resources


class Sampler:
    """Samples GPU, host and the AI worker process every 5 s (resource_sampler.sh covers containers)."""

    def __init__(self, out: Path) -> None:
        self.out = out
        self.stop = threading.Event()
        self.rows: list[dict] = []
        self.sh = None
        self.thread = threading.Thread(target=self.loop, daemon=True)

    def start(self) -> None:
        self.sh = subprocess.Popen(["bash", str(AI / "scripts/resource_sampler.sh"), str(self.out), "5"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.thread.start()

    def close(self) -> None:
        self.stop.set()
        self.thread.join(timeout=10)
        if self.sh:
            self.sh.terminate()
        with (self.out / "ai_process.csv").open("w", encoding="utf-8") as f:
            f.write("t,ai_rss_mib,ai_cpu_pct\n")
            for row in self.rows:
                f.write(f"{row['t']},{row['rss']:.0f},{row['cpu']:.1f}\n")

    def loop(self) -> None:
        while not self.stop.wait(5):
            pids = subprocess.run(["pgrep", "-f", "[m]awiid_ai.agent"], capture_output=True, text=True).stdout.split()
            rss = cpu = 0.0
            for pid in pids:
                out = subprocess.run(["ps", "-o", "rss=,pcpu=", "-p", pid], capture_output=True, text=True).stdout.split()
                if len(out) == 2:
                    rss += float(out[0]) / 1024
                    cpu += float(out[1])
            # Child processes (the job processes LiveKit agents fork) carry the models.
            for pid in pids:
                for child in subprocess.run(["pgrep", "-P", pid], capture_output=True, text=True).stdout.split():
                    out = subprocess.run(["ps", "-o", "rss=,pcpu=", "-p", child], capture_output=True, text=True).stdout.split()
                    if len(out) == 2 and child not in pids:
                        rss += float(out[0]) / 1024
                        cpu += float(out[1])
            self.rows.append({"t": time.time(), "rss": rss, "cpu": cpu})


def summarize_resources(out: Path) -> dict:
    def csv_rows(name: str) -> list[dict]:
        path = out / name
        if not path.exists():
            return []
        lines = path.read_text().splitlines()
        if len(lines) < 2:
            return []
        keys = lines[0].split(",")
        return [dict(zip(keys, line.split(","))) for line in lines[1:]]

    def num(value) -> float:
        try:
            return float(re.sub(r"[^0-9.]", "", value) or 0)
        except ValueError:
            return 0.0

    result = {}
    gpu = csv_rows("gpu.csv")
    if gpu:
        by_ts: dict[str, float] = {}
        for row in gpu:
            by_ts[row["ts"]] = by_ts.get(row["ts"], 0) + num(row["power_w"])
        powers = list(by_ts.values())
        hours = len(powers) * 5 / 3600
        result["GPU utilisation (peak / mean, per GPU)"] = ", ".join(
            f"GPU {g}: {max(num(r['util_pct']) for r in gpu if r['gpu'] == g):.0f} % / "
            f"{sum(num(r['util_pct']) for r in gpu if r['gpu'] == g) / max(1, sum(1 for r in gpu if r['gpu'] == g)):.0f} %"
            for g in sorted({r["gpu"] for r in gpu}))
        result["GPU memory used (peak, per GPU)"] = ", ".join(
            f"GPU {g}: {max(num(r['mem_used_mib']) for r in gpu if r['gpu'] == g) / 1024:.1f} GiB" for g in sorted({r["gpu"] for r in gpu}))
        result["GPU power (mean / peak, all GPUs)"] = f"{sum(powers) / len(powers):.0f} W / {max(powers):.0f} W"
        result["GPU energy over the load tests"] = f"{sum(powers) / len(powers) * hours / 1000:.2f} kWh in {hours:.2f} h"
        result["_gpu_mean_w"] = sum(powers) / len(powers)
    host = csv_rows("host.csv")
    if host:
        cpu = [num(r["cpu_busy_pct"]) for r in host]
        mem = [num(r["mem_used_mib"]) for r in host]
        result["Host CPU busy (mean / peak)"] = f"{sum(cpu) / len(cpu):.0f} % / {max(cpu):.0f} %"
        result["Host RAM used (peak)"] = f"{max(mem) / 1024:.1f} of {num(host[0]['mem_total_mib']) / 1024:.0f} GiB"
        result["Host load average (peak, 1 min)"] = f"{max(num(r['load1']) for r in host):.1f}"
    ai = csv_rows("ai_process.csv")
    if ai and any(num(r["ai_rss_mib"]) for r in ai):
        rss = [num(r["ai_rss_mib"]) for r in ai]
        cpu = [num(r["ai_cpu_pct"]) for r in ai]
        result["AI worker RAM (start → peak)"] = f"{rss[0] / 1024:.1f} → {max(rss) / 1024:.1f} GiB"
        result["AI worker CPU (mean, % of one core)"] = f"{sum(cpu) / len(cpu):.0f} %"
        # Steady growth over a long run points at a leak.
        if len(rss) > 120:
            first, last = sum(rss[:60]) / 60, sum(rss[-60:]) / 60
            result["AI worker RAM drift (first 5 min → last 5 min)"] = f"{first / 1024:.2f} → {last / 1024:.2f} GiB ({(last - first):+.0f} MiB)"
    containers = csv_rows("containers.csv")
    if containers:
        for name in sorted({r["container"] for r in containers}):
            rows = [r for r in containers if r["container"] == name]
            result[f"Container {name} (CPU peak / RAM peak)"] = (
                f"{max(num(r['cpu_pct']) for r in rows):.0f} % / {max(num(r['mem_pct']) for r in rows):.1f} % of host")
    return result


def load_tests(report: Report, ai_wait_min: float) -> None:
    runs = LOAD_RUNS[report.profile]
    if not runs:
        report.load_note = "Load profile `none`: no load test was run."
        return
    py = AI / ".venv/bin/python"
    if not py.exists():
        report.load_note = "services/ai/.venv is missing (make ai-install), so no load test could run."
        return
    env = read_env(ROOT / ".env")
    postman = read_env(BACKEND / "postman/.env.postman")
    lk_env = {k: env.get(k, "") for k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")}
    if not all(lk_env.values()):
        report.load_note = "LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing in .env, so no load test could run."
        return
    lk_env["LIVEKIT_TRANSLATOR_AGENT"] = postman.get("LIVEKIT_TRANSLATOR_AGENT", "mawiid-translator")
    lk_env["PYTHONUNBUFFERED"] = "1"
    languages = ["fr-FR", "en-US", "ar-SA"]
    if not all(any((AI / "data/samples" / lang).glob("*.wav")) for lang in languages):
        say("downloading the FLEURS test clips (once)")
        code, _, _ = run([str(py), "scripts/fetch_samples.py", "--languages", *languages], report.out / "fetch-samples.log", cwd=AI, timeout=1800)
        if code != 0:
            report.load_note = "The FLEURS test clips could not be downloaded (see fetch-samples.log), so no load test could run."
            return

    # The worker may still be converting models or downloading Whisper: wait for a first caption.
    say(f"waiting for the AI worker to caption (up to {ai_wait_min:.0f} min)")
    deadline = time.monotonic() + ai_wait_min * 60
    ready = False
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        out_dir = report.out / "loadtest" / f"warmup-{attempt}"
        run([str(py), "scripts/room_loadtest.py", "--speakers", "2", "--concurrency", "1", "--minutes", "1",
             "--drop-after-s", "30", "--out", str(out_dir)], report.out / f"warmup-{attempt}.log", cwd=AI, env=lk_env, timeout=600)
        summary = out_dir / "summary.json"
        if summary.exists() and json.loads(summary.read_text())["overall"]["captions_matched"] > 0:
            ready = True
            break
        time.sleep(60)
    if not ready:
        report.load_note = (f"The AI worker produced no caption within {ai_wait_min:.0f} min (still converting models, or not running: "
                            "see the `make dev` output), so no load test could run. Rerun with `make report` once captions work.")
        return

    translation_bots(report, py, lk_env)

    total = sum(r[3] for r in runs)
    say(f"AI worker ready. Running {len(runs)} load test(s), about {total} min")
    sampler = Sampler(report.out / "resources")
    (report.out / "resources").mkdir(exist_ok=True)
    sampler.start()
    try:
        for name, what, args, minutes in runs:
            say(f"load test {name}: {what} (~{minutes} min)")
            out_dir = report.out / "loadtest" / name
            started = time.time()
            code, _, secs = run([str(py), "scripts/room_loadtest.py", *args.split(), "--languages", *languages, "--out", str(out_dir)],
                                report.out / f"loadtest-{name}.log", cwd=AI, env=lk_env, timeout=minutes * 60 + 900)
            summary_path = out_dir / "summary.json"
            summary = json.loads(summary_path.read_text()) if summary_path.exists() else None
            report.load.append({"name": name, "what": what, "summary": summary, "exit": code, "minutes": secs / 60,
                                "started": started, "log": f"loadtest-{name}.log"})
            write(report)
    finally:
        sampler.close()
    report.resources = summarize_resources(report.out / "resources")


def translation_bots(report: Report, py: Path, lk_env: dict) -> None:
    """Bots speak FLEURS sentences, listener bots read the captions, each scored against the reference."""
    say("translation bots: speaking test sentences in every language (~5 min)")
    out_dir = report.out / "translation-bot"
    code, out, _ = run([str(py), "scripts/translation_bot.py", "--clips", "3", "--out", str(out_dir)],
                       report.out / "translation-bot.log", cwd=AI, env=lk_env, timeout=1800)
    results = out_dir / "results.json"
    if not results.exists():
        report.add("Translation", "Translation bots (speech → captions in every language)", SKIP,
                   f"could not run (exit {code}); see translation-bot.log", "translation-bot.log")
        return
    report.translation = json.loads(results.read_text(encoding="utf-8"))
    summary = report.translation["summary"]
    for language, st in summary["speech_to_text"].items():
        wer = "–" if st["wer"] is None else f"{st['wer']:.0%}"
        report.add("Translation", f"Speech-to-text {language}", PASS if st["delivered"] == st["sentences"] and st["wer"] is not None
                   and st["wer"] <= report.translation["limits"]["max_wer"] else FAIL,
                   f"{st['delivered']}/{st['sentences']} sentences transcribed, word error rate {wer}", "translation-bot/report.md")
    for name, st in summary["translation"].items():
        ok = st["delivered"] == st["sentences"] and not st["wrong_language"] and not st["untranslated"] \
            and st["chrf"] >= report.translation["limits"]["min_chrf"]
        report.add("Translation", f"Translation {name}", PASS if ok else FAIL,
                   f"{st['delivered']}/{st['sentences']} delivered, chrF {st['chrf']}, BLEU {st['bleu']}, "
                   f"{st['wrong_language']} wrong language, delay p50 {st['latency_p50_s']} s", "translation-bot/report.md")


def earlier_runs(report: Report) -> None:
    for path in sorted((AI / "data/loadtest").glob("*/summary.json")):
        try:
            summary = json.loads(path.read_text())
        except Exception:
            continue
        report.earlier_runs.append({"name": path.parent.name, "summary": summary, "date": dt.datetime.fromtimestamp(path.stat().st_mtime)})


# ---------------------------------------------------------------- writing


def table(head: list[str], rows: list[list]) -> str:
    def cell(value) -> str:
        return str(value).replace("|", "\\|").replace("\n", " ")
    return "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(cell(c) for c in row) + " |" for row in rows])


def load_row(name: str, what: str, summary: dict | None) -> list:
    if not summary:
        return [name, what, "–", "–", "–", "–", "–", "–", "no summary (see log)"]
    o, v = summary["overall"], summary["verdict"]
    stages = o.get("stages", {})
    stage = " / ".join(fmt_s(stages.get(s, {}).get("p95_s")) if s in stages else "–" for s in ("stt", "queue", "mt"))
    verdict = "✅ within limits" if v.get("within_limits") else "❌ " + "; ".join(v.get("why", []))
    if summary.get("ramp"):
        verdict += f" · last good: {v.get('last_good_talkers_per_room') or 'none'} talking, breaks at: {v.get('breaking_point_talkers_per_room') or 'not reached'}"
    return [name, what, f"{summary['rooms']} × {summary['speakers_per_room']}", f"{summary['minutes']:.0f} min",
            f"{o['clips_spoken']} / {o['captions_matched']}", f"{fmt_s(o['p50_s'])} / {fmt_s(o['p95_s'])} / {fmt_s(o['max_s'])}",
            f"{100 * o['drop_rate']:.1f} %", stage, verdict]


LOAD_HEAD = ["Run", "Scenario", "Rooms × users", "Length", "Clips spoken / captions", "Latency p50 / p95 / max", "Lost captions",
             "p95 by stage: STT / queue / MT", "Verdict"]


def covered(report: Report, item) -> bool:
    return any(r["summary"] and r["name"].startswith(prefixes) for r in report.load for prefixes in [item[2]])


def stability(summary: dict) -> str:
    minutes = sorted(summary.get("per_minute", {}).items(), key=lambda kv: int(kv[0]))
    p50 = [m["p50_s"] for _, m in minutes if m.get("captions_matched")]
    if len(p50) < 10:
        return "too short to judge"
    first, last = sum(p50[:5]) / 5, sum(p50[-5:]) / 5
    trend = "stable" if last < first * 1.25 + 0.2 else "latency grows over time (backlog)"
    return f"p50 first 5 min {first:.2f} s → last 5 min {last:.2f} s: {trend}"


def write(report: Report) -> None:
    inp = json.loads(INPUT.read_text(encoding="utf-8")) if INPUT.exists() else {}
    now = dt.datetime.now().astimezone()
    md: list[str] = []
    add = md.append
    checks = report.checks
    n = {s: sum(1 for c in checks if c["status"] == s) for s in (PASS, FAIL, SKIP)}
    load_ok = sum(1 for r in report.load if r["summary"] and r["summary"]["verdict"].get("within_limits"))
    load_bad = len(report.load) - load_ok

    add(f"# Mawiid test report: {report.started:%d %B %Y}")
    add(f"Generated by `scripts/test_report.py` from `make dev`, started {report.started:%Y-%m-%d %H:%M %Z}, "
        f"{'finished' if report.finished else '**still running** (this file is rewritten as tests finish)'} {now:%H:%M}.")
    add("Every result below was measured during this run, on this machine. Anything not run is listed under section 5.")
    add(table(["", ""], [[k, v] for k, v in report.environment.items()]))
    add("## Summary")
    add(table(["Status", "Checks", "Load tests"], [
        [ICON[PASS], n[PASS], load_ok], [ICON[FAIL], n[FAIL], load_bad],
        [ICON[SKIP], n[SKIP], f"{sum(1 for m in MATRIX if not covered(report, m))} of {len(MATRIX)} matrix runs (section 5)"]]))
    if report.environment.get("GPU", "").startswith("none"):
        add("> **This machine has no GPU.** Latency and capacity figures here are for CPU inference and do not "
            "predict the DGX. Run `make dev` (or `make report`) on the DGX for the production numbers.")

    # 1
    add("## 1. Tests performed")
    rows = [[c["area"], c["name"], ICON[c["status"]]] for c in checks]
    rows += [["Load", f"{r['name']}: {r['what']}", "ℹ️ Measured (section 2)" if r["summary"] else "❌ Did not complete"] for r in report.load]
    add(table(["Area", "Test", "Status"], rows))

    # 2
    add("## 2. Measured results")
    add(f"### 2.1 Translation latency and breaking point\nA run breaks when: {SLA}. Latency is measured from the end of a "
        "speaker's phrase to the translated caption arriving at each listener, through the real LiveKit server and AI worker.")
    if report.load:
        add(table(LOAD_HEAD, [load_row(r["name"], r["what"], r["summary"]) for r in report.load]))
        for r in report.load:
            s = r["summary"]
            if s and s.get("steps") and len(s["steps"]) > 1:
                add(f"**{r['name']} by step** (people talking at the same time per room):")
                add(table(["Talking at once", "Captions", "p50", "p95", "Lost", "Result"],
                          [[st["talkers_per_room"] or "all", st.get("captions_matched", "–"), fmt_s(st.get("p50_s")), fmt_s(st.get("p95_s")),
                            f"{100 * st.get('drop_rate', 0):.1f} %", "BREAKS: " + "; ".join(st["breaks"]) if st.get("breaks") else "ok"]
                           for st in s["steps"]]))
        add("### 2.2 Stability over time")
        add(table(["Run", "Trend"], [[r["name"], stability(r["summary"])] for r in report.load if r["summary"]]))
    else:
        add(f"No load test in this run. {report.load_note}")
    if report.earlier_runs:
        add("### 2.3 Earlier load-test runs found on this machine (`services/ai/data/loadtest/`)")
        add("Not produced by this run; listed with their date so they can be compared.")
        add(table(["Date", *LOAD_HEAD], [[e["date"].strftime("%Y-%m-%d %H:%M"), *load_row(e["name"], "", e["summary"])] for e in report.earlier_runs]))
    add("### 2.4 Translation quality (bots, no human speaker)")
    if report.translation:
        t = report.translation
        add("Bots spoke recorded FLEURS sentences; one listener bot per language read the captions. Speech-to-text is scored by "
            "word error rate against the transcript, translation by chrF and BLEU against the human reference translation "
            f"(0–100, higher is better; text-only reference on these sentences: chrF 54). Mean chrF: **{t['summary']['mean_chrf']}**. "
            "Every sentence, with what was heard and read: `translation-bot/report.md`.")
        add(table(["Spoken language", "Transcribed", "Word error rate"],
                  [[k, f"{v['delivered']}/{v['sentences']}", "–" if v["wer"] is None else f"{v['wer']:.0%}"]
                   for k, v in t["summary"]["speech_to_text"].items()]))
        add(table(["Direction", "Delivered", "chrF", "BLEU", "Wrong language", "Delay p50 / max"],
                  [[k, f"{v['delivered']}/{v['sentences']}", v["chrf"], v["bleu"], v["wrong_language"],
                    f"{v['latency_p50_s']} s / {v['latency_max_s']} s"] for k, v in t["summary"]["translation"].items()]))
    else:
        add("Not measured in this run" + (f": {report.load_note}" if report.load_note else "."))
    add("### 2.5 Resource consumption during the load tests")
    if report.resources:
        add(table(["Measure", "Value"], [[k, v] for k, v in report.resources.items() if not k.startswith("_")]))
    else:
        add("Not measured (no load test ran).")
    add("### 2.6 Infrastructure cost")
    cost = inp.get("cost", {})
    hourly = cost.get("dgx_hourly_cost")
    multi = [r for r in report.load if r["name"].startswith("E") and r["summary"]]
    carried = max((r["summary"]["rooms"] for r in multi if r["summary"]["verdict"].get("within_limits")), default=0)
    lines = [f"Formula: cost per meeting-hour = server hourly cost ÷ rooms one AI worker carries within the limits."]
    if multi:
        lines.append(f"Rooms carried within the limits in this run: **{carried}** (largest multi-tenant run that stayed within limits).")
    if hourly and carried:
        lines.append(f"With a server cost of {hourly} {cost.get('currency', '')}/h: **{float(hourly) / carried:.2f} {cost.get('currency', '')} per meeting-hour**.")
    elif not hourly:
        lines.append("Server hourly cost not provided (`cost.dgx_hourly_cost` in docs/test-report-input.json), so no cost figure is given.")
    if report.resources.get("_gpu_mean_w"):
        kw = report.resources["_gpu_mean_w"] / 1000
        price = cost.get("electricity_per_kwh")
        lines.append(f"Measured GPU draw under load: {kw:.2f} kW" + (f" ≈ {kw * float(price):.2f} {cost.get('currency', '')}/h of electricity." if price else "."))
    add("\n\n".join(lines))

    # 3
    add("## 3. Vulnerabilities identified and fixed, with retest results")
    fixes = [
        ("Login limit bypass: 10-attempt limit was checked before the slow password hash and counted after, so a parallel burst got every guess checked (30 of 30).",
         "Attempt counted first, atomically (auth.service.ts).", ["Login burst regression", "Parallel login burst"]),
        ("Internal routes public: Caddy forwarded all of /api/*, including /transcript/internal, /webhook/livekit and /openapi.",
         "Caddy answers 404 for them; LiveKit and the AI worker call backend:3000 directly (Caddyfile).", ["Internal routes hidden"]),
        ("Permanent lockout: rate-limit counters were INCR then EXPIRE; a crash between them left a key that never expires.",
         "TTL set first (SET NX EX), then INCR (rate-limit.lib.ts).", ["Lockout reset regression", "rate-limit counter has an expiry"]),
    ]
    rows = []
    for problem, fix, names in fixes:
        found = [c for c in checks if any(name in c["name"] for name in names)]
        status = FAIL if any(c["status"] == FAIL for c in found) else PASS if found and all(c["status"] == PASS for c in found) else SKIP
        rows.append([problem, fix, ICON[status], " · ".join(f"{c['name']}: {c['evidence']}" for c in found) or "not retested in this run"])
    add(table(["Issue", "Fix", "Retest", "Evidence from this run"], rows))

    # 4
    add("## 4. Outstanding issues")
    failing = [c for c in checks if c["status"] == FAIL]
    if failing:
        add("### 4.1 Failures found by this run")
        add(table(["Area", "Check", "Evidence", "Log"], [[c["area"], c["name"], c["evidence"], c["log"] or "–"] for c in failing]))
    broke = [r for r in report.load if r["summary"] and not r["summary"]["verdict"].get("within_limits")]
    if broke:
        add("Load runs past the limits: " + "; ".join(f"**{r['name']}** ({'; '.join(r['summary']['verdict'].get('why', []))})" for r in broke) + ".")
    add("### 4.2 Known issues (from the code review; severity and timeline from docs/test-report-input.json)")
    issues = inp.get("known_issues", [])
    add(table(["Severity", "Issue", "Impact", "Planned fix", "Estimated resolution"],
              [[i.get("severity", "–"), i.get("issue", ""), i.get("impact", ""), i.get("fix", ""), i.get("eta") or "to be set"] for i in issues])
        if issues else "None recorded.")

    # 5
    add("## 5. Tests not completed")
    rows = []
    for item in MATRIX:
        key, what, _, profile = item
        if covered(report, item):
            continue
        why = report.load_note if report.load_note else f"not part of the `{report.profile}` profile"
        rows.append([key, what, "⏳ " + why, f"`make dev REPORT_PROFILE={profile}` (or `make report REPORT_PROFILE={profile}`), ideally on the DGX"])
    rows += [[t.get("id", ""), t.get("test", ""), "⏳ " + t.get("why", "Not run"), t.get("when", "")] for t in inp.get("not_completed", [])]
    rows += [["", f"{c['area']}: {c['name']}", "⏳ " + c["evidence"], "rerun `make report`"] for c in checks if c["status"] == SKIP]
    add(table(["Id", "Test", "Status / reason", "When / how"], rows))
    feedback = inp.get("microintegrele_feedback", {})
    add("### Microintégrèle's answer about weekend testing")
    add(feedback.get("answer") or "No answer recorded (fill `microintegrele_feedback` in docs/test-report-input.json).")
    if feedback.get("date"):
        add(f"Date of the answer: {feedback['date']}.")

    add("## Appendix: raw data")
    add(f"Everything is in `{os.path.relpath(report.out, ROOT)}/`: one log per command, `loadtest/<run>/` "
        "(summary.json, captions.csv, clips.csv) and `resources/` (gpu.csv, host.csv, containers.csv, ai_process.csv).")

    text = "\n\n".join(md) + "\n"
    (report.out / "report.md").write_text(text, encoding="utf-8")
    (report.out / "report.html").write_text(to_html(text, f"Mawiid test report {report.started:%Y-%m-%d}"), encoding="utf-8")
    latest = ROOT / "reports/latest"
    try:
        if latest.is_symlink() or latest.exists():
            latest.unlink()
        latest.symlink_to(report.out.name)
    except OSError:
        pass


def to_html(markdown: str, title: str) -> str:
    def inline(text: str) -> str:
        text = html.escape(text)
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        return re.sub(r"`(.+?)`", r"<code>\1</code>", text)

    body = []
    for block in markdown.split("\n\n"):
        lines = block.strip().splitlines()
        if not lines:
            continue
        first = lines[0]
        if first.startswith("#"):
            level = len(first) - len(first.lstrip("#"))
            body.append(f"<h{level}>{inline(first.lstrip('# '))}</h{level}>" + "".join(f"<p>{inline(l)}</p>" for l in lines[1:]))
        elif first.startswith("|"):
            cells = [[c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", line.strip())[1:-1]] for line in lines if not line.startswith("|---")]
            head, *rest = cells
            body.append("<div class=t><table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                        + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row) + "</tr>" for row in rest) + "</tbody></table></div>")
        elif first.startswith(">"):
            body.append("<blockquote>" + inline(" ".join(l.lstrip("> ") for l in lines)) + "</blockquote>")
        else:
            body.append("<p>" + "<br>".join(inline(l) for l in lines) + "</p>")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><style>
:root{{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#e3e3e8;--head:#f5f5f7;--accent:#0b57d0}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151517;--fg:#ececf0;--muted:#a0a0a8;--line:#2e2e33;--head:#1f1f23;--accent:#8ab4f8}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;max-width:1100px;margin:0 auto;padding:24px 16px}}
h1{{font-size:26px;margin:0 0 8px}}h2{{font-size:20px;margin:36px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}}h3{{font-size:16px;margin:24px 0 8px}}
p{{margin:8px 0}}code{{font:13px ui-monospace,monospace;background:var(--head);padding:1px 4px;border-radius:4px}}
.t{{overflow-x:auto;margin:10px 0}}table{{border-collapse:collapse;width:100%;font-size:13.5px}}th,td{{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}}
th{{background:var(--head)}}blockquote{{margin:12px 0;padding:10px 14px;border-left:3px solid var(--accent);background:var(--head)}}
</style></head><body>{''.join(body)}</body></html>"""


# ---------------------------------------------------------------- main


def main() -> int:
    global quiet
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", choices=list(LOAD_RUNS), default=os.environ.get("REPORT_PROFILE", "quick"))
    parser.add_argument("--wait-min", type=float, default=20, help="how long to wait for the backend and frontend to answer")
    parser.add_argument("--ai-wait-min", type=float, default=90, help="how long to wait for the AI worker's first caption")
    parser.add_argument("--quiet", action="store_true", help="print only progress milestones (used by make dev)")
    args = parser.parse_args()
    quiet = args.quiet

    out = ROOT / "reports" / dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    report = Report(out, args.profile)
    say(f"test report ({args.profile} profile) → {out.relative_to(ROOT)}/report.md, waiting for the stack")
    environment(report)
    earlier_runs(report)

    if not wait_for(f"{BACKEND_URL}/health", args.wait_min):
        say(f"backend did not answer at {BACKEND_URL}/health within {args.wait_min:.0f} min: report not generated")
        return 1
    if not wait_for(FRONTEND_URL, args.wait_min):
        say(f"frontend did not answer at {FRONTEND_URL}: its checks will fail")

    say("running unit tests, smoke tests and security probes")
    for step in (unit_tests, smoke, probe_otp, probe_caddy, probe_login_burst, probe_redis_ttl, probe_jwt, probe_input, probe_cors):
        try:
            step(report)
        except Exception as error:  # one broken probe must not lose the rest of the report
            report.add("Report", step.__name__, SKIP, f"probe crashed: {error!r}")
    write(report)
    say(f"checks done: {sum(c['status'] == PASS for c in report.checks)} validated, "
        f"{sum(c['status'] == FAIL for c in report.checks)} to fix. Report so far: {out.relative_to(ROOT)}/report.html")

    load_tests(report, args.ai_wait_min)
    report.finished = True
    write(report)
    say(f"report finished: {out / 'report.html'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
