"""MCP Streamable HTTP handshake helper shared by load-test scripts.

The MCP Streamable HTTP transport requires a 2-step handshake before any
`tools/call` will be accepted by the server :

  1. POST `initialize` and capture the `Mcp-Session-Id` response header.
  2. POST `notifications/initialized` with that header.
  3. All subsequent `tools/call` POSTs must include the `Mcp-Session-Id`
     header.

Without the handshake, the server replies with "Missing session ID".

This helper caches the session id on the `httpx.AsyncClient` instance so
the handshake runs exactly once per client. Multiple modules (`synthetic`,
`stability`, `run_scenario`, `observer_test`, ...) re-use it instead of
each duplicating ~30 lines of boilerplate.
"""

from __future__ import annotations
from typing import Any, Dict

import httpx


MCP_HEADERS: Dict[str, str] = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
}


async def ensure_mcp_session(client: httpx.AsyncClient, url: str) -> str:
    """Do MCP Streamable HTTP handshake if not yet done. Returns session id.

    Caches the session id on the client instance (`_mcp_session_id` attr)
    so subsequent calls short-circuit. Pass the same `client` instance to
    keep the same session.
    """
    sid = getattr(client, "_mcp_session_id", None)
    if sid:
        return sid
    init_body: Dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": "init",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "agent4live-loadtest", "version": "0.1"},
        },
    }
    r = await client.post(url, json=init_body, headers=MCP_HEADERS)
    r.raise_for_status()
    sid = r.headers.get("Mcp-Session-Id")
    if not sid:
        raise RuntimeError("Server did not return Mcp-Session-Id")
    # Send the required notifications/initialized (no response expected).
    await client.post(
        url,
        json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
        headers={**MCP_HEADERS, "Mcp-Session-Id": sid},
    )
    client._mcp_session_id = sid  # type: ignore[attr-defined]
    return sid


def session_headers(sid: str) -> Dict[str, str]:
    """Return the MCP headers including the session id for a tools/call."""
    return {**MCP_HEADERS, "Mcp-Session-Id": sid}
