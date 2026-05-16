"""Orchestrate a scenario : invoke the right driver, write run_NNN.json.

Usage:
  python run_scenario.py s1
  python run_scenario.py s2
  python run_scenario.py s3
"""

from __future__ import annotations
import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path


RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"


def next_run_number() -> int:
    RESULTS_DIR.mkdir(exist_ok=True)
    existing = sorted(RESULTS_DIR.glob("run_*.json"))
    if not existing:
        return 1
    last = existing[-1].stem.split("_")[1]
    return int(last) + 1


def run_synthetic(args) -> dict:
    cmd = [sys.executable, "synthetic.py", args.scenario]
    if args.scenario == "s1":
        cmd += ["--calls", "1000"]
    else:  # s2
        cmd += ["--rps", "50", "--duration", "300"]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True,
                         cwd=Path(__file__).parent)
    return json.loads(out.stdout)


def run_stability(args) -> dict:
    cmd = [sys.executable, "stability.py", "--duration", str(args.duration)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True,
                         cwd=Path(__file__).parent)
    samples = [json.loads(line) for line in out.stdout.strip().splitlines()]
    return {"scenario": "S3", "duration_s": args.duration, "samples": samples}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("scenario", choices=["s1", "s2", "s3"])
    p.add_argument("--duration", type=int, default=12 * 3600)
    args = p.parse_args()

    if args.scenario in ("s1", "s2"):
        result = run_synthetic(args)
    else:
        result = run_stability(args)

    result["timestamp"] = datetime.datetime.utcnow().isoformat() + "Z"
    n = next_run_number()
    out_path = RESULTS_DIR / f"run_{n:03d}.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
