"""Synthetic MCP client for S1 (sequential latency) and S2 (sustained burst).

Drives the proto server over HTTP/MCP using httpx. Writes a JSON metrics
blob to stdout that run_scenario.py captures into results/run_NNN.json.

Usage:
  python synthetic.py s1 --url http://127.0.0.1:19846/mcp --calls 1000
  python synthetic.py s2 --url http://127.0.0.1:19846/mcp --rps 50 --duration 300
"""

from __future__ import annotations
import argparse
import asyncio
import json
import random
import statistics
import sys
import time
from typing import Any, Dict, List

import httpx


def latency_summary(timings_ms: List[float]) -> Dict[str, float]:
    if not timings_ms:
        return {"count": 0, "min_ms": 0.0, "max_ms": 0.0,
                "p50_ms": 0.0, "p95_ms": 0.0, "p99_ms": 0.0, "p99_9_ms": 0.0,
                "mean_ms": 0.0}
    sorted_t = sorted(timings_ms)
    n = len(sorted_t)
    def pct(p):
        # Nearest-rank percentile: index = floor(p * n), clamped to n-1.
        # Matches the contract in tests/test_synthetic.py (p99 of 99×1.0 + 1×1000.0 == 1000.0).
        k = max(0, min(n - 1, int(p * n)))
        return sorted_t[k]
    return {
        "count": len(timings_ms),
        "min_ms": sorted_t[0],
        "max_ms": sorted_t[-1],
        "p50_ms": pct(0.50),
        "p95_ms": pct(0.95),
        "p99_ms": pct(0.99),
        "p99_9_ms": pct(0.999),
        "mean_ms": statistics.fmean(timings_ms),
    }


_MCP_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
}


async def _ensure_session(client: httpx.AsyncClient, url: str) -> str:
    """Do MCP Streamable HTTP handshake if not yet done. Returns session id.

    The MCP Streamable HTTP transport requires:
      1. POST `initialize` to capture Mcp-Session-Id response header.
      2. POST `notifications/initialized` with that header.
      3. All subsequent tools/call POSTs include Mcp-Session-Id.

    We cache the session id on the client instance to handshake once.
    """
    sid = getattr(client, "_mcp_session_id", None)
    if sid:
        return sid
    init_body = {
        "jsonrpc": "2.0",
        "id": "init",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "synthetic", "version": "0.1"},
        },
    }
    r = await client.post(url, json=init_body, headers=_MCP_HEADERS)
    r.raise_for_status()
    sid = r.headers.get("Mcp-Session-Id")
    if not sid:
        raise RuntimeError("Server did not return Mcp-Session-Id")
    # Send the required notifications/initialized (no response expected)
    await client.post(
        url,
        json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
        headers={**_MCP_HEADERS, "Mcp-Session-Id": sid},
    )
    client._mcp_session_id = sid  # type: ignore[attr-defined]
    return sid


async def _call(client: httpx.AsyncClient, url: str, rpc_id: int, name: str, args: Dict[str, Any]) -> float:
    sid = await _ensure_session(client, url)
    body = {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": "tools/call",
        "params": {"name": name, "arguments": args},
    }
    headers = {**_MCP_HEADERS, "Mcp-Session-Id": sid}
    t0 = time.perf_counter()
    r = await client.post(url, json=body, headers=headers)
    elapsed = (time.perf_counter() - t0) * 1000.0
    r.raise_for_status()
    return elapsed


async def run_s1(url: str, calls: int) -> Dict[str, Any]:
    timings: List[float] = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        for i in range(calls):
            t = await _call(client, url, i, "lom_get", {"path": "live_set tempo"})
            timings.append(t)
    return {"scenario": "S1", "url": url, "calls": calls, "latency": latency_summary(timings)}


async def run_s2(url: str, rps: int, duration_s: int) -> Dict[str, Any]:
    """Sustained mix : 70% lom_get, 25% lom_set, 5% lom_call(create + delete).

    Uses asyncio.gather with a per-second batch to enforce the rate.
    """
    timings: List[float] = []
    rng = random.Random(0xC0FFEE)
    started = time.perf_counter()
    error_count = 0

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Warm up the session before timing the burst so the handshake
        # cost isn't billed to the first batch.
        await _ensure_session(client, url)
        rpc_id = 0
        while time.perf_counter() - started < duration_s:
            tick_start = time.perf_counter()
            tasks = []
            for _ in range(rps):
                roll = rng.random()
                if roll < 0.70:
                    tasks.append(_call(client, url, rpc_id, "lom_get",
                                       {"path": "live_set tempo"}))
                elif roll < 0.95:
                    new_tempo = round(120.0 + rng.random() * 8.0, 1)
                    tasks.append(_call(client, url, rpc_id, "lom_set",
                                       {"path": "live_set tempo", "value": new_tempo}))
                else:
                    tasks.append(_call(client, url, rpc_id, "lom_call",
                                       {"path": "live_set",
                                        "method": "create_audio_track",
                                        "args": [-1]}))
                rpc_id += 1
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, float):
                    timings.append(r)
                else:
                    error_count += 1
            # Pace to 1 second per batch
            elapsed = time.perf_counter() - tick_start
            if elapsed < 1.0:
                await asyncio.sleep(1.0 - elapsed)

    return {
        "scenario": "S2",
        "url": url,
        "rps": rps,
        "duration_s": duration_s,
        "calls": len(timings),
        "errors": error_count,
        "latency": latency_summary(timings),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("scenario", choices=["s1", "s2"])
    p.add_argument("--url", default="http://127.0.0.1:19846/mcp")
    p.add_argument("--calls", type=int, default=1000)
    p.add_argument("--rps", type=int, default=50)
    p.add_argument("--duration", type=int, default=300)
    args = p.parse_args()

    if args.scenario == "s1":
        result = asyncio.run(run_s1(args.url, args.calls))
    else:
        result = asyncio.run(run_s2(args.url, args.rps, args.duration))
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
