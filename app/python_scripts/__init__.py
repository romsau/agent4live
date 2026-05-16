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
Live's API must only be touched on the main UI thread. We follow the
AbletonOSC pattern (5 years in production, NIME 2023): the listening
socket is non-blocking and lives on the main thread, polled via
`schedule_message(1, self._tick)` which re-arms itself every ~100 ms.
`_tick` accepts new clients non-blockingly, drains any pending data,
dispatches inline, writes the response and closes the connection — all
on the main thread, with zero background threads. This eliminates the
cross-thread synchronization overhead of the previous queue+Event design.

Reference: github.com/ideoforms/AbletonOSC/blob/master/manager.py `tick()`.
"""

from __future__ import absolute_import, print_function, unicode_literals

import json
import socket
import traceback

from _Framework.ControlSurface import ControlSurface


HOST = "127.0.0.1"
PORT = 54321
PROTOCOL_VERSION = 6  # bumped from 5 : AbletonOSC main-thread tick pattern (no background threads)

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



class Agent4LiveCompanion(ControlSurface):
    """Remote Script that exposes a JSON-over-TCP control channel, polled
    on Live's main thread via schedule_message (AbletonOSC pattern). All
    Live API calls happen inline in `_tick`, so they are always on the
    main UI thread by construction.
    """

    def __init__(self, c_instance):
        super(Agent4LiveCompanion, self).__init__(c_instance)
        self._server = None
        # Per-connection state : list of {"sock": <socket>, "buf": b""}.
        # Each connection is short-lived (one JSON line, one response, close).
        self._connections = []
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((HOST, PORT))
            s.listen(5)
            s.setblocking(0)
            self._server = s
            # Kick off the main-thread polling loop. _tick will re-arm itself.
            self.schedule_message(1, self._tick)
            self.log_message(
                "agent4live companion v%d started on %s:%d (main-thread tick)"
                % (PROTOCOL_VERSION, HOST, PORT)
            )
        except Exception:
            self.log_message("agent4live companion failed to start:\n" + traceback.format_exc())

    # ── Lifecycle ───────────────────────────────────────────────────────────

    def disconnect(self):
        """Called by Live when the script is unloaded (or Live quits).

        Close any pending client sockets first, then the server socket.
        Without this, orphan sockets block reload on the same port.
        """
        for conn in self._connections:
            try:
                conn["sock"].close()
            except Exception:
                pass
        self._connections = []
        if self._server is not None:
            try:
                self._server.close()
            except Exception:
                pass
            self._server = None
        super(Agent4LiveCompanion, self).disconnect()

    # ── Main-thread polling tick (AbletonOSC pattern) ──────────────────────

    def _tick(self):
        """Polled by Live's scheduler every ~100 ms on the main thread.

        1. Drain new accepts (non-blocking) until BlockingIOError.
        2. For each connection, try a non-blocking recv ; on a complete JSON
           line, dispatch + respond + close ; on EOF/error, drop.
        3. Always re-arm at the end, even on unexpected exception.
        """
        try:
            # 1. Accept any pending connections.
            if self._server is not None:
                while True:
                    try:
                        client, _addr = self._server.accept()
                        client.setblocking(0)
                        self._connections.append({"sock": client, "buf": b""})
                    except BlockingIOError:
                        break
                    except Exception:
                        # Don't let a bad accept crash the tick.
                        self.log_message(
                            "agent4live accept error:\n" + traceback.format_exc()
                        )
                        break

            # 2. Service existing connections.
            still_open = []
            for conn in self._connections:
                sock = conn["sock"]
                drop = False
                try:
                    while True:
                        try:
                            chunk = sock.recv(4096)
                        except BlockingIOError:
                            break
                        except Exception:
                            drop = True
                            break
                        if not chunk:
                            # EOF before a full line — drop.
                            drop = True
                            break
                        conn["buf"] += chunk
                        if b"\n" in conn["buf"]:
                            break

                    if not drop and b"\n" in conn["buf"]:
                        line = conn["buf"].split(b"\n", 1)[0]
                        try:
                            msg = json.loads(line.decode("utf-8"))
                        except Exception as e:
                            response = {"ok": False, "error": "bad JSON: " + str(e)}
                        else:
                            try:
                                response = self._dispatch(msg)
                            except Exception as e:
                                response = {
                                    "ok": False,
                                    "error": str(e),
                                    "trace": traceback.format_exc(),
                                }
                        try:
                            sock.sendall((json.dumps(response) + "\n").encode("utf-8"))
                        except Exception:
                            pass
                        drop = True
                except Exception:
                    try:
                        self.log_message(
                            "agent4live client error:\n" + traceback.format_exc()
                        )
                    except Exception:
                        pass
                    drop = True

                if drop:
                    try:
                        sock.close()
                    except Exception:
                        pass
                else:
                    still_open.append(conn)
            self._connections = still_open
        finally:
            # Always re-arm, even on unexpected exception. Without this,
            # the script silently goes dead after the first hiccup.
            try:
                self.schedule_message(1, self._tick)
            except Exception:
                pass

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
        if method == "send_midi":
            return self._handle_send_midi(
                int(msg.get("status", 0)),
                int(msg.get("data1", 0)),
                int(msg.get("data2", 0)),
            )
        return {"ok": False, "error": "unknown method: " + str(method)}

    def _handle_send_midi(self, status, data1, data2):
        # Send a 3-byte MIDI message on the Output port assigned to this
        # Control Surface slot in Live → Preferences → Tempo & MIDI. If the
        # slot has Output = "None", the message is silently dropped by Live.
        # We bypass _Framework.ControlSurface._send_midi (which has tricky
        # inheritance plumbing) and call the C++ instance directly with the
        # 3-byte tuple — the documented Ableton MidiRemoteScript API.
        try:
            self._c_instance.send_midi((status & 0xFF, data1 & 0x7F, data2 & 0x7F))
            return {"ok": True}
        except Exception as e:  # pragma: no cover (Live API edge-case)
            return {"ok": False, "error": "send_midi failed: " + str(e)}

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
