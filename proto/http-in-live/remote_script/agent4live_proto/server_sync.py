# proto/http-in-live/remote_script/agent4live_proto/server_sync.py
"""Fallback A — hand-rolled JSON-RPC MCP over http.server.ThreadingHTTPServer.

Drops in to replace server.py's run_server_thread without changing the
bridge or lom_exec contracts. No asyncio. No SDK. Just stdlib.

Implements just enough of MCP for Claude Code :
  - JSON-RPC 2.0 over HTTP POST
  - initialize / initialized
  - tools/list
  - tools/call
"""

from __future__ import absolute_import, print_function, unicode_literals

import http.server
import json
import socketserver
import sys
import threading
import time

PROTOCOL_VERSION = "2024-11-05"


def run_server_thread(bridge, diag, port=19846):
    handler_cls = _make_handler(bridge, diag)
    # Set allow_reuse_address BEFORE binding (it's a class attribute). Live
    # may reload the Remote Script before the old thread has fully released
    # the socket — SO_REUSEADDR lets us re-bind anyway.
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    server = socketserver.ThreadingTCPServer(("127.0.0.1", port), handler_cls)
    t = threading.Thread(target=server.serve_forever, name="agent4live-proto-server-sync",
                         daemon=True)
    t.start()
    return server, t


def _make_handler(bridge, diag):

    def proto_diag_handler():
        return {
            "python_version": sys.version,
            "asyncio_loop_running": False,
            "queue_depth": bridge.queue_depth(),
            "main_thread_drain_count": diag.drain_count,
            "uptime_s": time.time() - diag.start_time,
        }

    def call_tool(name, arguments):
        slot = {"event": threading.Event(), "result": None}
        if name == "lom_get":
            msg = {"op": "get", "path": arguments["path"]}
        elif name == "lom_set":
            msg = {"op": "set", "path": arguments["path"], "value": arguments["value"]}
        elif name == "lom_call":
            msg = {"op": "call", "path": arguments["path"], "method": arguments["method"],
                   "args": arguments.get("args", [])}
        elif name == "proto_diag":
            return {"content": [{"type": "text", "text": json.dumps(proto_diag_handler())}]}
        else:
            return {"content": [{"type": "text", "text": json.dumps({"ok": False, "error": "unknown tool"})}], "isError": True}
        bridge._queue.put((msg, slot))
        if not slot["event"].wait(timeout=30.0):
            return {"content": [{"type": "text", "text": json.dumps({"ok": False, "error": "timeout"})}], "isError": True}
        return {"content": [{"type": "text", "text": json.dumps(slot["result"])}]}

    class _Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # silence noisy default logging
            return

        def do_POST(self):
            if self.path != "/mcp":
                self.send_response(404); self.end_headers(); return
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            try:
                req = json.loads(body)
            except Exception:
                self.send_response(400); self.end_headers(); return

            method = req.get("method")
            req_id = req.get("id")
            params = req.get("params", {})

            if method == "initialize":
                response = {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "agent4live-proto", "version": "1.0"},
                }
            elif method == "tools/list":
                response = {"tools": _TOOLS_DECL}
            elif method == "tools/call":
                response = call_tool(params["name"], params.get("arguments", {}))
            elif method == "notifications/initialized":
                self.send_response(204); self.end_headers(); return
            else:
                self.send_response(404); self.end_headers(); return

            payload = {"jsonrpc": "2.0", "id": req_id, "result": response}
            data = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return _Handler


_TOOLS_DECL = [
    {
        "name": "lom_get",
        "description": "Read a Live Object Model property.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "lom_set",
        "description": "Write a Live Object Model property.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}, "value": {}},
            "required": ["path", "value"],
        },
    },
    {
        "name": "lom_call",
        "description": "Invoke a Live Object Model method.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "method": {"type": "string"},
                "args": {"type": "array", "items": {}},
            },
            "required": ["path", "method"],
        },
    },
    {
        "name": "proto_diag",
        "description": "Return runtime diagnostics for the prototype (not a LOM call).",
        "inputSchema": {"type": "object", "properties": {}},
    },
]
