"""Detect audio dropouts in a recorded .wav file.

A dropout is a sudden discontinuity in the audio signal — either a
sample-to-sample jump that exceeds a threshold, or a silent gap that
shouldn't be there. We use a first-difference approach : compute
|x[n] - x[n-1]| and flag samples where this exceeds `threshold`
(in normalized [-1, 1] amplitude).

For musical content, threshold=0.5 is reasonable : real audio rarely
changes by more than ±0.5 in a single sample at 48 kHz. Adjustable per
invocation.
"""

from __future__ import annotations
import argparse
import json
import sys
from typing import Any, Dict, List

import numpy as np
from scipy.io import wavfile


def find_discontinuities(samples: np.ndarray, sr: int, threshold: float = 0.5) -> List[Dict[str, Any]]:
    if samples.ndim > 1:
        # Stereo or multi-channel : take max across channels
        samples = np.max(np.abs(samples), axis=1)
    if samples.dtype.kind == "i":
        # Normalize int PCM to [-1, 1]
        max_val = float(2 ** (8 * samples.dtype.itemsize - 1))
        samples = samples.astype(np.float32) / max_val
    diffs = np.abs(np.diff(samples))
    indices = np.where(diffs > threshold)[0]
    drops: List[Dict[str, Any]] = []
    for idx in indices:
        drops.append({
            "sample": int(idx),
            "time_s": float(idx) / sr,
            "jump": float(diffs[idx]),
        })

    # Also detect silent gaps embedded in otherwise non-silent audio.
    # A silent gap is a run of samples below `silence_eps` that is bordered
    # on both sides by samples whose envelope exceeds `loud_eps`. This
    # catches dropouts that happen across zero-crossings where the
    # first-difference approach misses them.
    silence_eps = 1e-4
    loud_eps = max(threshold * 0.5, 0.1)
    min_gap_samples = max(1, int(sr * 0.001))  # at least 1 ms of silence

    abs_samples = np.abs(samples)
    silent_mask = abs_samples < silence_eps
    if silent_mask.any() and (~silent_mask).any():
        # Find contiguous runs of silence
        edges = np.diff(silent_mask.astype(np.int8))
        starts = np.where(edges == 1)[0] + 1
        ends = np.where(edges == -1)[0] + 1
        # If the signal starts silent, prepend 0; if it ends silent, append len
        if silent_mask[0]:
            starts = np.concatenate(([0], starts))
        if silent_mask[-1]:
            ends = np.concatenate((ends, [len(samples)]))

        # Compute a short pre/post envelope window
        env_window = max(min_gap_samples, int(sr * 0.002))  # 2 ms
        for s, e in zip(starts, ends):
            if e - s < min_gap_samples:
                continue
            pre_lo = max(0, s - env_window)
            post_hi = min(len(samples), e + env_window)
            pre_env = float(abs_samples[pre_lo:s].max()) if s > pre_lo else 0.0
            post_env = float(abs_samples[e:post_hi].max()) if post_hi > e else 0.0
            if pre_env > loud_eps and post_env > loud_eps:
                drops.append({
                    "sample": int(s),
                    "time_s": float(s) / sr,
                    "jump": float(max(pre_env, post_env)),
                    "kind": "silent_gap",
                    "length_samples": int(e - s),
                })

    drops.sort(key=lambda d: d["sample"])
    return drops


def main():
    p = argparse.ArgumentParser()
    p.add_argument("wav_path")
    p.add_argument("--threshold", type=float, default=0.5)
    args = p.parse_args()
    sr, samples = wavfile.read(args.wav_path)
    drops = find_discontinuities(samples, sr, args.threshold)
    out = {
        "wav_path": args.wav_path,
        "sample_rate": sr,
        "duration_s": len(samples) / sr,
        "threshold": args.threshold,
        "dropout_count": len(drops),
        "dropouts": drops[:20],  # cap at 20 in the report
    }
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
