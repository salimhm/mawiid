from mawiid_ai.metrics import Counter, Histogram


def test_histogram_exports_cumulative_prometheus_buckets_without_sensitive_values():
    histogram = Histogram("caption_latency_seconds", "Caption latency.", ("engine",))

    histogram.observe(0.1, {"engine": "whisper"})
    histogram.observe(1.0, {"engine": "whisper"})

    rendered = "\n".join(histogram.render())
    assert '# TYPE caption_latency_seconds histogram' in rendered
    assert 'caption_latency_seconds_bucket{engine="whisper",le="0.1"} 1' in rendered
    assert 'caption_latency_seconds_bucket{engine="whisper",le="1"} 2' in rendered
    assert 'caption_latency_seconds_count{engine="whisper"} 2' in rendered


def test_counter_escapes_labels():
    counter = Counter("caption_events_total", "Caption events.", ("outcome",))

    counter.inc({"outcome": 'bad"value'})

    assert 'outcome="bad\\"value"' in "\n".join(counter.render())
