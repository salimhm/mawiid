"""Small, dependency-free Prometheus metrics for the local AI worker.

Metrics intentionally contain only bounded operational labels.  Caption text, room IDs,
participant identities and track IDs must never be added here: they are both sensitive and
unbounded, which makes Prometheus expensive and unsafe to operate.
"""

from __future__ import annotations

import os
import threading
from collections import defaultdict
from collections.abc import Mapping
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60)


def _escape(value: object) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(labels: tuple[str, ...], values: tuple[str, ...]) -> str:
    return "{" + ",".join(f'{key}="{_escape(value)}"' for key, value in zip(labels, values, strict=True)) + "}"


class Histogram:
    def __init__(self, name: str, description: str, label_names: tuple[str, ...] = ()) -> None:
        self.name = name
        self.description = description
        self.label_names = label_names
        self._values: dict[tuple[str, ...], list[float]] = defaultdict(lambda: [0.0] * (len(_BUCKETS) + 2))
        self._lock = threading.Lock()

    def observe(self, value: float, labels: Mapping[str, str] | None = None) -> None:
        if value < 0:
            return
        values = tuple((labels or {}).get(label, "") for label in self.label_names)
        with self._lock:
            series = self._values[values]
            for index, bucket in enumerate(_BUCKETS):
                if value <= bucket:
                    series[index] += 1
            series[-2] += value
            series[-1] += 1

    def render(self) -> list[str]:
        rows = [f"# HELP {self.name} {self.description}", f"# TYPE {self.name} histogram"]
        with self._lock:
            values = {labels: list(series) for labels, series in self._values.items()}
        for label_values, series in values.items():
            base = dict(zip(self.label_names, label_values, strict=True))
            for index, bucket in enumerate(_BUCKETS):
                rows.append(f"{self.name}_bucket{_labels(tuple((*base, 'le')), tuple((*base.values(), str(bucket))))} {series[index]:g}")
            rows.append(f"{self.name}_bucket{_labels(tuple((*base, 'le')), tuple((*base.values(), '+Inf')))} {series[-1]:g}")
            rows.append(f"{self.name}_sum{_labels(self.label_names, label_values)} {series[-2]:g}")
            rows.append(f"{self.name}_count{_labels(self.label_names, label_values)} {series[-1]:g}")
        return rows


class Counter:
    def __init__(self, name: str, description: str, label_names: tuple[str, ...] = ()) -> None:
        self.name = name
        self.description = description
        self.label_names = label_names
        self._values: dict[tuple[str, ...], float] = defaultdict(float)
        self._lock = threading.Lock()

    def inc(self, labels: Mapping[str, str] | None = None) -> None:
        values = tuple((labels or {}).get(label, "") for label in self.label_names)
        with self._lock:
            self._values[values] += 1

    def render(self) -> list[str]:
        rows = [f"# HELP {self.name} {self.description}", f"# TYPE {self.name} counter"]
        with self._lock:
            values = dict(self._values)
        for label_values, value in values.items():
            rows.append(f"{self.name}{_labels(self.label_names, label_values)} {value:g}")
        return rows


class Gauge:
    def __init__(self, name: str, description: str) -> None:
        self.name = name
        self.description = description
        self._value = 0
        self._lock = threading.Lock()

    def inc(self) -> None:
        with self._lock:
            self._value += 1

    def dec(self) -> None:
        with self._lock:
            self._value = max(0, self._value - 1)

    def render(self) -> list[str]:
        with self._lock:
            value = self._value
        return [f"# HELP {self.name} {self.description}", f"# TYPE {self.name} gauge", f"{self.name} {value}"]


caption_transcription_duration = Histogram(
    "mawiid_caption_transcription_duration_seconds",
    "Time spent running speech-to-text for an audio chunk.",
    ("engine", "outcome"),
)
caption_translation_queue_duration = Histogram(
    "mawiid_caption_translation_queue_duration_seconds",
    "Time a subtitle waits for an earlier translation of the same speaker.",
    ("kind",),
)
caption_translation_duration = Histogram(
    "mawiid_caption_translation_duration_seconds",
    "Time spent translating a caption.",
    ("engine", "outcome"),
)
caption_publish_duration = Histogram(
    "mawiid_caption_publish_duration_seconds",
    "Time spent publishing a caption through LiveKit.",
    ("topic", "outcome"),
)
caption_processing_latency = Histogram(
    "mawiid_caption_processing_latency_seconds",
    "Audio-end to caption-publish processing latency; it excludes client network delivery.",
    ("kind", "topic"),
)
caption_events = Counter(
    "mawiid_caption_events_total",
    "Caption pipeline events by component and outcome.",
    ("component", "outcome"),
)
caption_active_tracks = Gauge(
    "mawiid_caption_active_tracks",
    "Audio tracks currently handled by the caption pipeline.",
)

_metrics = (
    caption_transcription_duration,
    caption_translation_queue_duration,
    caption_translation_duration,
    caption_publish_duration,
    caption_processing_latency,
    caption_events,
    caption_active_tracks,
)


def render() -> str:
    """Return the Prometheus text exposition without customer content or identifiers."""
    return "\n".join(row for metric in _metrics for row in metric.render()) + "\n"


_server: ThreadingHTTPServer | None = None
_server_lock = threading.Lock()


def start_metrics_server() -> None:
    """Expose worker metrics once for a local Prometheus collector."""
    if os.environ.get("MAWIID_METRICS_ENABLED", "true").lower() in {"0", "false", "no"}:
        return
    with _server_lock:
        global _server
        if _server is not None:
            return
        host = os.environ.get("MAWIID_METRICS_HOST", "0.0.0.0")
        port = int(os.environ.get("MAWIID_METRICS_PORT", "9464"))

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - HTTP handler API
                if self.path != "/metrics":
                    self.send_error(HTTPStatus.NOT_FOUND)
                    return
                payload = render().encode()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format: str, *_args: object) -> None:
                return

        _server = ThreadingHTTPServer((host, port), Handler)
        threading.Thread(target=_server.serve_forever, name="prometheus-metrics", daemon=True).start()
