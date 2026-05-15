"""Tests for tools.py — the MCP tool handlers.

The handlers are async wrappers around `bridge.submit(...)`. We inject a
fake bridge that returns canned responses.
"""

import asyncio
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "remote_script"))

from agent4live_proto.tools import build_handlers


class FakeBridge:
    def __init__(self, response):
        self.response = response
        self.submitted = []

    async def submit(self, msg):
        self.submitted.append(msg)
        return self.response

    def queue_depth(self):
        return 0


class FakeDiag:
    def __init__(self):
        self.drain_count = 42
        self.start_time = 0.0


@pytest.mark.asyncio
async def test_lom_get_dispatches_correctly():
    bridge = FakeBridge({"ok": True, "value": 124.0})
    handlers = build_handlers(bridge, FakeDiag())
    result = await handlers["lom_get"](path="live_set tempo")
    assert bridge.submitted == [{"op": "get", "path": "live_set tempo"}]
    assert result["ok"] is True
    assert result["value"] == 124.0


@pytest.mark.asyncio
async def test_lom_set_dispatches_correctly():
    bridge = FakeBridge({"ok": True})
    handlers = build_handlers(bridge, FakeDiag())
    result = await handlers["lom_set"](path="live_set tempo", value=128.0)
    assert bridge.submitted == [{"op": "set", "path": "live_set tempo", "value": 128.0}]
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_lom_call_dispatches_correctly():
    bridge = FakeBridge({"ok": True, "value": "Created Track"})
    handlers = build_handlers(bridge, FakeDiag())
    result = await handlers["lom_call"](path="live_set", method="create_audio_track", args=[-1])
    assert bridge.submitted == [{
        "op": "call",
        "path": "live_set",
        "method": "create_audio_track",
        "args": [-1],
    }]
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_proto_diag_returns_runtime_info():
    bridge = FakeBridge(None)
    diag = FakeDiag()
    handlers = build_handlers(bridge, diag)
    result = await handlers["proto_diag"]()
    assert "python_version" in result
    assert "queue_depth" in result
    assert result["queue_depth"] == 0
    assert result["main_thread_drain_count"] == 42
    assert "uptime_s" in result
