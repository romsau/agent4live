"""Live ControlSurface bootstrap for the HTTP-in-Live prototype.

Imported only by __init__.create_instance() (which Live invokes). Stays
out of the package's top-level import path so pytest can import sibling
modules (bridge, lom_exec, tools) without needing Live's bundled Python.

Boot sequence (inside __init__):
  1. Build the Bridge + Diag.
  2. Start the FastMCP server on a daemon thread (its own asyncio loop).
  3. Hook update_display() to drain the bridge queue at ~30 Hz.
"""

from __future__ import absolute_import, print_function, unicode_literals

import time
import traceback

from _Framework.ControlSurface import ControlSurface

from .bridge import Bridge
from .lom_exec import execute
from .server_sync import run_server_thread


DRAIN_BATCH_SIZE = 4   # messages per update_display tick (~30 Hz)
PORT = 19846            # different from prod :19845
PROTO_VERSION = 1


class _Diag:
    """Mutable counters that proto_diag exposes via MCP."""
    def __init__(self):
        self.drain_count = 0
        self.start_time = time.time()


class Agent4LiveProto(ControlSurface):
    def __init__(self, c_instance):
        super(Agent4LiveProto, self).__init__(c_instance)
        try:
            self._diag = _Diag()
            self._bridge = Bridge(main_thread_timeout_s=30.0)
            self._server_thread = run_server_thread(self._bridge, self._diag, port=PORT)
            self.log_message(
                "agent4live_proto v%d started on 127.0.0.1:%d (HTTP MCP)" % (PROTO_VERSION, PORT)
            )
        except Exception:
            self.log_message("agent4live_proto failed to start:\n" + traceback.format_exc())

    def disconnect(self):
        # Server thread is daemon ; it dies with the Live process. We don't
        # try to shutdown uvicorn cleanly because that requires async coord.
        super(Agent4LiveProto, self).disconnect()

    def update_display(self):
        super(Agent4LiveProto, self).update_display()
        try:
            n = self._bridge.drain(
                lambda msg: execute(self.song(), msg),
                max_items=DRAIN_BATCH_SIZE,
            )
            self._diag.drain_count += n
        except Exception:
            self.log_message("agent4live_proto drain crashed:\n" + traceback.format_exc())
