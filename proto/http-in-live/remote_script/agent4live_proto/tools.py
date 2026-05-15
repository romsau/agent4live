"""MCP tool handlers — async wrappers around the bridge.

build_handlers(bridge, diag) returns a dict of async functions that the
FastMCP server registers as tools. Each handler stays minimal: validate
shape, hand off to bridge, return the response.

Handlers are kept dict-returning (not pydantic models) because the proto
only validates feasibility — not response polishing.
"""

import sys
import time
from typing import Any, Dict, List, Optional


def build_handlers(bridge, diag) -> Dict[str, Any]:
    async def lom_get(path: str) -> Dict[str, Any]:
        """Read a LOM property. Example: path='live_set tempo'."""
        return await bridge.submit({"op": "get", "path": path})

    async def lom_set(path: str, value: Any) -> Dict[str, Any]:
        """Write a LOM property. Example: path='live_set tempo', value=128.0."""
        return await bridge.submit({"op": "set", "path": path, "value": value})

    async def lom_call(
        path: str, method: str, args: Optional[List[Any]] = None
    ) -> Dict[str, Any]:
        """Call a LOM method. Example: path='live_set', method='create_audio_track', args=[-1]."""
        return await bridge.submit({
            "op": "call",
            "path": path,
            "method": method,
            "args": args or [],
        })

    async def proto_diag() -> Dict[str, Any]:
        """Return runtime diagnostics for the proto itself (not a LOM tool)."""
        return {
            "python_version": sys.version,
            "asyncio_loop_running": True,
            "queue_depth": bridge.queue_depth(),
            "main_thread_drain_count": diag.drain_count,
            "uptime_s": time.time() - diag.start_time,
        }

    return {
        "lom_get": lom_get,
        "lom_set": lom_set,
        "lom_call": lom_call,
        "proto_diag": proto_diag,
    }
