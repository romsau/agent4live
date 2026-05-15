"""Unit tests for bridge.py — the queue ↔ asyncio.Future glue.

The bridge has two sides:
  - Background (asyncio) side: `submit(request) -> Awaitable[response]`
  - Main-thread side: `drain(handler, max_items)` processes queued messages.

We test both sides with a fake main thread (synchronous, in-test).
"""

import asyncio
import sys
from pathlib import Path
import pytest

# Make the remote_script package importable from the test
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "remote_script"))

from agent4live_proto.bridge import Bridge


@pytest.mark.asyncio
async def test_submit_returns_drained_value():
    bridge = Bridge(main_thread_timeout_s=2.0)

    async def driver():
        return await bridge.submit({"op": "get", "path": "live_set tempo"})

    task = asyncio.create_task(driver())
    # Let the worker thread put the message on the queue
    await asyncio.sleep(0.05)
    drained = bridge.drain(lambda msg: {"ok": True, "value": 124.0}, max_items=4)
    assert drained == 1
    result = await task
    assert result == {"ok": True, "value": 124.0}


@pytest.mark.asyncio
async def test_submit_times_out_when_drain_never_called():
    bridge = Bridge(main_thread_timeout_s=0.1)
    result = await bridge.submit({"op": "get", "path": "nope"})
    assert result["ok"] is False
    assert "timed out" in result["error"]


@pytest.mark.asyncio
async def test_drain_handles_handler_exception():
    bridge = Bridge(main_thread_timeout_s=2.0)

    async def driver():
        return await bridge.submit({"op": "get", "path": "boom"})

    task = asyncio.create_task(driver())
    await asyncio.sleep(0.05)
    def crashing_handler(msg):
        raise RuntimeError("simulated LOM crash")
    bridge.drain(crashing_handler, max_items=4)
    result = await task
    assert result["ok"] is False
    assert "simulated LOM crash" in result["error"]


@pytest.mark.asyncio
async def test_drain_respects_max_items():
    bridge = Bridge(main_thread_timeout_s=2.0)

    async def driver(i):
        return await bridge.submit({"op": "get", "path": str(i)})

    tasks = [asyncio.create_task(driver(i)) for i in range(10)]
    await asyncio.sleep(0.05)
    drained = bridge.drain(lambda msg: {"ok": True, "value": msg["path"]}, max_items=4)
    assert drained == 4
    # Drain again to flush the rest so the test doesn't hang
    bridge.drain(lambda msg: {"ok": True, "value": msg["path"]}, max_items=10)
    results = await asyncio.gather(*tasks)
    assert {r["value"] for r in results} == {str(i) for i in range(10)}


def test_queue_depth_property():
    bridge = Bridge(main_thread_timeout_s=2.0)
    assert bridge.queue_depth() == 0
