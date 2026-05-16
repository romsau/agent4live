import sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from detect_dropouts import find_discontinuities


def test_clean_signal_has_no_discontinuities():
    # A 1 kHz sine, 1 sec at 48 kHz
    sr = 48000
    t = np.arange(sr) / sr
    x = (np.sin(2 * np.pi * 1000 * t) * 0.5).astype(np.float32)
    drops = find_discontinuities(x, sr, threshold=0.5)
    assert drops == []


def test_inserted_gap_is_detected():
    sr = 48000
    t = np.arange(sr) / sr
    x = (np.sin(2 * np.pi * 1000 * t) * 0.5).astype(np.float32)
    # Insert a 5 ms gap of zeros around sample 24000
    x_gap = x.copy()
    x_gap[24000:24000 + int(0.005 * sr)] = 0.0
    drops = find_discontinuities(x_gap, sr, threshold=0.3)
    assert len(drops) >= 1
    # Drop position is within the gap window
    assert any(23900 <= d["sample"] <= 24300 for d in drops)


def test_threshold_filters_micro_jumps():
    sr = 48000
    x = np.zeros(sr, dtype=np.float32)
    x[1000] = 0.1  # tiny jump
    drops = find_discontinuities(x, sr, threshold=0.5)
    assert drops == []
