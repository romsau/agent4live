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

import sys
import time
import traceback

# R3 mitigation : force the GIL to switch threads every 1 ms instead of the
# Python default (5 ms) — when measured in Live 12.4 the effective switch
# interval was ~200 ms, suggesting Live's main thread holds the GIL in long
# bursts. A tighter interval forces more frequent yields so our HTTP server
# thread can actually run.
sys.setswitchinterval(0.001)

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
        self._server = None
        self._server_thread = None
        try:
            self._diag = _Diag()
            self._bridge = Bridge(main_thread_timeout_s=30.0)
            self._server, self._server_thread = run_server_thread(
                self._bridge, self._diag, port=PORT
            )
            self.log_message(
                "agent4live_proto v%d started on 127.0.0.1:%d (HTTP MCP)" % (PROTO_VERSION, PORT)
            )
        except Exception:
            self.log_message("agent4live_proto failed to start:\n" + traceback.format_exc())

    def disconnect(self):
        # Shut down the HTTP server so its port is released before Live
        # reloads us (Remote Script slot toggle, Live restart, etc.).
        # Without this the next instance fails with "Address already in use".
        if self._server is not None:
            try:
                self._server.shutdown()
                self._server.server_close()
            except Exception:
                self.log_message("agent4live_proto shutdown error:\n" + traceback.format_exc())
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
