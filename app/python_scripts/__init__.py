"""agent4live companion — Remote Script bridging Live's Python API to the
agent4live MCP device via a local TCP socket.

The MCP device (Node-for-Max) runs a Max [js] LOM router for the bits that
ARE exposed to Max. Browser API isn't, so this companion picks up the slack:
it listens on 127.0.0.1:54321 and forwards JSON commands to Live's Python
API (Application.browser, Browser.load_item, etc).

Install location:
  ~/Music/Ableton/User Library/Remote Scripts/agent4live/

After install, open Live → Preferences → Link/Tempo/MIDI → assign
"agent4live" in any Control Surface dropdown slot (Input/Output = None).

Threading model
---------------
Live's API must only be touched on the main UI thread. The TCP listener
runs on a background thread, so we never call browser.load_item directly
from there — it crashes Live. Instead, requests go through a thread-safe
queue and are drained by the framework's `update_display()` callback,
which Live invokes on the main thread (~30 Hz). The TCP thread blocks on
a per-request `Event` until the main thread fills in the result.
"""

from __future__ import absolute_import, print_function, unicode_literals

import json
import socket
import threading
import traceback

try:
    # Python 3.x stdlib
    import queue
except ImportError:  # pragma: no cover (Live 11+ is always Python 3)
    import Queue as queue

from _Framework.ControlSurface import ControlSurface


HOST = "127.0.0.1"
PORT = 54321
PROTOCOL_VERSION = 4

# Top-level Browser roots, in the order Live's UI presents them.
BROWSER_ROOTS = (
    "sounds",
    "drums",
    "instruments",
    "audio_effects",
    "midi_effects",
    "plugins",
    "samples",
    "clips",
    "user_library",
    "current_project",
    "packs",
)
BROWSER_DEPTH_CAP = 15  # safety: stops runaway DFS in pack trees
SEARCH_DEFAULT_LIMIT = 50

# Per-request budgets. The TCP thread waits this long for the main thread to
# return a result before erroring out.
MAIN_THREAD_TIMEOUT_S = 30.0
DRAIN_BATCH_SIZE = 4  # how many queued messages to process per update_display tick


class Agent4LiveCompanion(ControlSurface):
    """Remote Script that exposes a JSON-over-TCP control channel, with all
    Live API calls marshalled onto the main thread for safety.
    """

    def __init__(self, c_instance):
        super(Agent4LiveCompanion, self).__init__(c_instance)
        self._stop = threading.Event()
        self._server = None
        self._server_thread = None
        # Background TCP threads put (message, slot) tuples here ; main thread
        # drains them in update_display(). slot = {'event', 'result'}.
        self._main_queue = queue.Queue()
        try:
            self._start_listener()
            self.log_message(
                "agent4live companion v%d started on %s:%d (queued main-thread dispatch)"
                % (PROTOCOL_VERSION, HOST, PORT)
            )
        except Exception:
            self.log_message("agent4live companion failed to start:\n" + traceback.format_exc())

    # ── Lifecycle ───────────────────────────────────────────────────────────

    def disconnect(self):
        """Called by Live when the script is unloaded (or Live quits)."""
        self._stop.set()
        try:
            self._server.close()
        except Exception:
            pass
        super(Agent4LiveCompanion, self).disconnect()

    # ── Main-thread dispatch (called by Live ~30 Hz on the UI thread) ──────

    def update_display(self):
        super(Agent4LiveCompanion, self).update_display()
        for _ in range(DRAIN_BATCH_SIZE):
            try:
                msg, slot = self._main_queue.get_nowait()
            except queue.Empty:
                return
            try:
                slot["result"] = self._dispatch(msg)
            except Exception as e:
                slot["result"] = {
                    "ok": False,
                    "error": str(e),
                    "trace": traceback.format_exc(),
                }
            slot["event"].set()

    # ── TCP listener (background thread) ────────────────────────────────────

    def _start_listener(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((HOST, PORT))
        s.listen(5)
        s.settimeout(1.0)  # so the accept loop can periodically check _stop
        self._server = s
        t = threading.Thread(target=self._accept_loop, name="agent4live-companion-accept")
        t.daemon = True
        t.start()
        self._server_thread = t

    def _accept_loop(self):
        while not self._stop.is_set():
            try:
                client, _addr = self._server.accept()
            except socket.timeout:
                continue
            except Exception:
                if not self._stop.is_set():
                    self.log_message("agent4live accept error:\n" + traceback.format_exc())
                return
            # Spawn a per-client worker so the accept loop stays responsive.
            t = threading.Thread(
                target=self._handle_client, args=(client,), name="agent4live-client"
            )
            t.daemon = True
            t.start()

    def _handle_client(self, client):
        try:
            client.settimeout(5.0)
            buf = b""
            while b"\n" not in buf:
                chunk = client.recv(4096)
                if not chunk:
                    return
                buf += chunk
            line = buf.split(b"\n", 1)[0]
            try:
                msg = json.loads(line.decode("utf-8"))
            except Exception as e:
                response = {"ok": False, "error": "bad JSON: " + str(e)}
            else:
                response = self._submit_to_main(msg)
            client.sendall((json.dumps(response) + "\n").encode("utf-8"))
        except Exception:
            try:
                self.log_message("agent4live client error:\n" + traceback.format_exc())
            except Exception:
                pass
        finally:
            try:
                client.close()
            except Exception:
                pass

    def _submit_to_main(self, msg):
        """Hand `msg` off to the main thread and block until it produces a
        result (or the budget expires).
        """
        slot = {"event": threading.Event(), "result": None}
        self._main_queue.put((msg, slot))
        if not slot["event"].wait(timeout=MAIN_THREAD_TIMEOUT_S):
            return {
                "ok": False,
                "error": "main-thread dispatch timed out after %ss" % MAIN_THREAD_TIMEOUT_S,
            }
        return slot["result"]

    # ── Dispatch (main thread) ──────────────────────────────────────────────

    def _dispatch(self, msg):
        method = msg.get("method", "")
        if method == "ping":
            return {"ok": True, "pong": True, "version": PROTOCOL_VERSION}
        if method == "browser_list":
            return self._browser_list(msg.get("path", ""))
        if method == "browser_load":
            return self._browser_load(msg.get("path", ""))
        if method == "browser_search":
            return self._browser_search(
                msg.get("query", ""),
                msg.get("root", ""),
                int(msg.get("limit", SEARCH_DEFAULT_LIMIT)),
            )
        return {"ok": False, "error": "unknown method: " + str(method)}

    def _browser(self):
        """Shortcut to the Live application's Browser singleton."""
        return self.application().browser

    @staticmethod
    def _item_dict(item):
        return {
            "name": getattr(item, "name", ""),
            "uri": getattr(item, "uri", ""),
            "is_folder": bool(getattr(item, "is_folder", False)),
            "is_loadable": bool(getattr(item, "is_loadable", False)),
        }

    def _browser_list(self, path):
        """List a node's children. Empty path = the named roots ;
        a slash-separated path descends by name (e.g. 'instruments/Drum Rack').
        """
        browser = self._browser()
        parts = [p for p in path.split("/") if p]
        if not parts:
            items = []
            for name in BROWSER_ROOTS:
                root = getattr(browser, name, None)
                if root is None:
                    continue
                items.append(
                    {
                        "name": getattr(root, "name", name),
                        "uri": name,  # synthetic — root's attr name is stable
                        "is_folder": True,
                        "is_loadable": False,
                    }
                )
            return {"ok": True, "items": items}

        root_name = parts[0]
        node = getattr(browser, root_name, None)
        if node is None:
            return {"ok": False, "error": "unknown root: " + root_name}
        for part in parts[1:]:
            match = None
            try:
                for child in node.children:
                    if getattr(child, "name", "") == part:
                        match = child
                        break
            except Exception:
                pass
            if match is None:
                return {"ok": False, "error": "unknown path: " + path}
            node = match
        try:
            items = [self._item_dict(c) for c in node.children]
        except Exception as e:
            return {"ok": False, "error": "children iteration failed: " + str(e)}
        return {"ok": True, "items": items}

    def _resolve_path(self, path):
        """Walk root → leaf along a slash-separated path. The first segment is
        a Browser root attr name ('drums', 'instruments', ...) ; subsequent
        segments are child display names. Returns the BrowserItem or None.
        """
        parts = [p for p in path.split("/") if p]
        if not parts:
            return None
        browser = self._browser()
        node = getattr(browser, parts[0], None)
        if node is None:
            return None
        for part in parts[1:]:
            match = None
            try:
                for child in node.children:
                    if getattr(child, "name", "") == part:
                        match = child
                        break
            except Exception:
                return None
            if match is None:
                return None
            node = match
        return node

    def _browser_load(self, path):
        if not path:
            return {"ok": False, "error": "missing path"}
        item = self._resolve_path(path)
        if item is None:
            return {"ok": False, "error": "path not found: " + path}
        if not getattr(item, "is_loadable", False):
            return {
                "ok": False,
                "error": "item is not loadable: " + getattr(item, "name", ""),
            }
        try:
            self._browser().load_item(item)
        except Exception as e:
            return {"ok": False, "error": "load_item failed: " + str(e)}
        return {"ok": True, "loaded": getattr(item, "name", "")}

    def _browser_search(self, query, root_filter, limit):
        if not query:
            return {"ok": False, "error": "missing query"}
        q = query.lower()
        browser = self._browser()
        # Each stack entry = (node, navigable_path, depth). The navigable path
        # starts with the attr name ('drums') so the result can be passed
        # straight back to browser_load without translation.
        stack = []
        for name in BROWSER_ROOTS:
            if root_filter and name != root_filter:
                continue
            r = getattr(browser, name, None)
            if r is not None:
                stack.append((r, "/" + name, 0))
        results = []
        while stack and len(results) < limit:
            node, path_str, depth = stack.pop()
            node_name = getattr(node, "name", "")
            if q in node_name.lower():
                results.append(
                    {
                        "name": node_name,
                        "path": path_str,
                        "is_loadable": bool(getattr(node, "is_loadable", False)),
                    }
                )
            if depth >= BROWSER_DEPTH_CAP:
                continue
            try:
                for c in node.children:
                    stack.append(
                        (c, path_str + "/" + getattr(c, "name", ""), depth + 1)
                    )
            except Exception:
                continue
        return {
            "ok": True,
            "results": results,
            "truncated": len(results) >= limit,
        }


def create_instance(c_instance):
    return Agent4LiveCompanion(c_instance)
