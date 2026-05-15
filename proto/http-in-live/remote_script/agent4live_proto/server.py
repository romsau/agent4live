"""FastMCP server + asyncio runner for the proto.

Started from the ControlSurface's __init__ in a background thread. The
thread owns its own asyncio event loop. Tool handlers are registered via
the FastMCP decorator API, which dispatches to bridge.submit() — that
hands the work off to Live's main thread.
"""

from __future__ import annotations
import asyncio
import threading
from typing import Any, List, Optional

from mcp.server.fastmcp import FastMCP
import uvicorn


def run_server_thread(bridge, diag, port: int = 19846) -> threading.Thread:
    """Start the FastMCP server on a daemon thread with its own asyncio loop."""

    def runner():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_serve(bridge, diag, port))
        except Exception:
            import traceback
            traceback.print_exc()
        finally:
            loop.close()

    t = threading.Thread(target=runner, name="agent4live-proto-server", daemon=True)
    t.start()
    return t


async def _serve(bridge, diag, port: int) -> None:
    from .tools import build_handlers
    handlers = build_handlers(bridge, diag)

    mcp = FastMCP("agent4live-proto")

    @mcp.tool()
    async def lom_get(path: str) -> dict:
        """Read a Live Object Model property. Example: path='live_set tempo'."""
        return await handlers["lom_get"](path)

    @mcp.tool()
    async def lom_set(path: str, value: Any) -> dict:
        """Write a Live Object Model property. Example: path='live_set tempo', value=128.0."""
        return await handlers["lom_set"](path, value)

    @mcp.tool()
    async def lom_call(
        path: str, method: str, args: Optional[List[Any]] = None
    ) -> dict:
        """Invoke a Live Object Model method. Example: path='live_set', method='create_audio_track', args=[-1]."""
        return await handlers["lom_call"](path, method, args)

    @mcp.tool()
    async def proto_diag() -> dict:
        """Return runtime diagnostics for the prototype (not a LOM call)."""
        return await handlers["proto_diag"]()

    # FastMCP exposes a Starlette app accessible via mcp.streamable_http_app()
    # (or mcp.sse_app() depending on SDK version). The HTTP MCP transport is
    # what Claude Code expects on http://127.0.0.1:19846/mcp .
    app = mcp.streamable_http_app()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    await server.serve()
