"""Run server.py outside Live with a fake bridge. Verify HTTP + MCP works.

Usage:
  python smoke_outside_live.py &
  # then in another terminal:
  curl -X POST http://127.0.0.1:19846/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
"""

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "remote_script"))

from agent4live_proto.server import run_server_thread


class FakeBridge:
    async def submit(self, msg):
        # Pretend the main thread answered instantly.
        if msg["op"] == "get":
            return {"ok": True, "value": 124.0}
        if msg["op"] == "set":
            return {"ok": True}
        return {"ok": True, "value": f"called {msg.get('method')}"}

    def queue_depth(self):
        return 0


class FakeDiag:
    def __init__(self):
        self.drain_count = 0
        self.start_time = time.time()


if __name__ == "__main__":
    bridge = FakeBridge()
    diag = FakeDiag()
    t = run_server_thread(bridge, diag, port=19846)
    print(f"Server thread started, alive={t.is_alive()}")
    print("Listening on http://127.0.0.1:19846/mcp")
    print("Press Ctrl-C to stop.")
    try:
        while t.is_alive():
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\nStopping.")
        sys.exit(0)
