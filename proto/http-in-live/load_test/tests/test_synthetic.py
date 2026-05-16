"""Tests for the metrics summarizer in synthetic.py.

We don't test the HTTP transport here — that's covered by S1/S2 against
a live server. We test that latency_summary() computes the right
percentiles from a list of timings.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from synthetic import latency_summary


def test_basic_percentiles():
    timings = [10.0, 20.0, 30.0, 40.0, 50.0]  # ms
    s = latency_summary(timings)
    assert s["count"] == 5
    assert s["min_ms"] == 10.0
    assert s["max_ms"] == 50.0
    # Median of 5 values
    assert s["p50_ms"] == 30.0


def test_p99_with_outlier():
    timings = [1.0] * 99 + [1000.0]
    s = latency_summary(timings)
    assert s["p99_ms"] == 1000.0


def test_empty_list_returns_zeros():
    s = latency_summary([])
    assert s["count"] == 0
    assert s["p50_ms"] == 0.0
