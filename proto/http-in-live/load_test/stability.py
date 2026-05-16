"""S3 endurance test : 5 req/s for 12 hours, with health sampling.

Every 15 minutes:
  - RSS of the Live process (ps -o rss)
  - File descriptor count (lsof -p <pid> | wc -l)
  - Latency p50/p99 from a fresh 100-call sample
  - proto_diag (queue_depth, drain_count, uptime)

Writes one JSON line per sample to stdout. run_scenario.py captures it.

Usage:
  python stability.py --url http://127.0.0.1:19846/mcp \\
                      --duration 43200 --rps 5
"""

from __future__ import annotations
import argparse
import asyncio
import json
import subprocess
import sys
import time
from typing import Any, Dict, List

import httpx

from mcp_handshake import ensure_mcp_session, session_headers


SAMPLE_INTERVAL_S = 15 * 60  # 15 minutes


def find_live_pid() -> int:
    """Return the macOS Ableton Live PID via pgrep. Live's process is named 'Live'."""
    out = subprocess.run(["pgrep", "-f", "Ableton Live"], capture_output=True, text=True)
    pids = [int(p) for p in out.stdout.strip().splitlines() if p.strip()]
    if not pids:
        raise RuntimeError("No Live process found (pgrep -f 'Ableton Live')")
    return pids[0]


def sample_rss(pid: int) -> int:
    """RSS in KB via `ps -o rss=`."""
    out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True)
    return int(out.stdout.strip())


def sample_fd_count(pid: int) -> int:
    """Open file descriptor count via `lsof -p <pid>` (header line included = +1, negligible)."""
    out = subprocess.run(["lsof", "-p", str(pid)], capture_output=True, text=True)
    return len(out.stdout.strip().splitlines())


async def sample_latency(url: str, calls: int = 100) -> Dict[str, Any]:
    """Quick latency probe against the proto. Returns p50 / p99 in ms."""
    timings: List[float] = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        sid = await ensure_mcp_session(client, url)
        headers = session_headers(sid)
        for i in range(calls):
            t0 = time.perf_counter()
            r = await client.post(
                url,
                json={
                    "jsonrpc": "2.0",
                    "id": i,
                    "method": "tools/call",
                    "params": {"name": "lom_get", "arguments": {"path": "live_set tempo"}},
                },
                headers=headers,
            )
            r.raise_for_status()
            timings.append((time.perf_counter() - t0) * 1000.0)
    timings.sort()
    return {
        "p50_ms": timings[len(timings) // 2],
        "p99_ms": timings[int(len(timings) * 0.99)],
    }


async def sample_proto_diag(url: str) -> Dict[str, Any]:
    """Fetch proto_diag (queue_depth, drain_count, uptime, ...)."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        sid = await ensure_mcp_session(client, url)
        r = await client.post(
            url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "proto_diag", "arguments": {}},
            },
            headers=session_headers(sid),
        )
        return r.json()


async def keepalive_load(url: str, rps: int, stop_event: asyncio.Event) -> None:
    """Background task : keep `rps` req/s flowing for the entire duration."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        sid = await ensure_mcp_session(client, url)
        headers = session_headers(sid)
        rpc_id = 0
        interval = 1.0 / rps if rps > 0 else 1.0
        while not stop_event.is_set():
            t0 = time.perf_counter()
            try:
                await client.post(
                    url,
                    json={
                        "jsonrpc": "2.0",
                        "id": rpc_id,
                        "method": "tools/call",
                        "params": {"name": "lom_get", "arguments": {"path": "live_set tempo"}},
                    },
                    headers=headers,
                )
            except Exception:
                # Swallow transient errors so the keepalive doesn't die during a 12h run.
                pass
            rpc_id += 1
            elapsed = time.perf_counter() - t0
            if elapsed < interval:
                await asyncio.sleep(interval - elapsed)


async def run(url: str, duration_s: int, rps: int) -> None:
    pid = find_live_pid()
    stop = asyncio.Event()
    bg = asyncio.create_task(keepalive_load(url, rps, stop))
    start = time.time()
    try:
        while time.time() - start < duration_s:
            sample: Dict[str, Any] = {
                "t": time.time(),
                "elapsed_s": time.time() - start,
                "rss_kb": sample_rss(pid),
                "fd_count": sample_fd_count(pid),
            }
            sample["latency"] = await sample_latency(url)
            sample["proto_diag"] = await sample_proto_diag(url)
            json.dump(sample, sys.stdout)
            sys.stdout.write("\n")
            sys.stdout.flush()
            await asyncio.sleep(SAMPLE_INTERVAL_S)
    finally:
        stop.set()
        await bg


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://127.0.0.1:19846/mcp")
    p.add_argument("--duration", type=int, default=12 * 3600, help="seconds (default 12h)")
    p.add_argument("--rps", type=int, default=5)
    args = p.parse_args()
    asyncio.run(run(args.url, args.duration, args.rps))


if __name__ == "__main__":
    main()
