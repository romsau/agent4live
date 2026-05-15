"""LOM executor — runs on Live's main thread.

Resolves a dotted/space-separated LOM path against a root object (Live's
`song`), then performs get / set / call. Pure synchronous code, no
threading or asyncio.

Paths use the same convention as the prod LOM router:
  "live_set tempo"                      → song.tempo
  "live_set tracks 0 name"              → song.tracks[0].name
  "live_set tracks 0 devices 1 parameters 3 value" → ...

Numeric tokens are treated as list indices.
"""

from typing import Any, Dict


def _step(node, tok):
    if tok.isdigit():
        try:
            return node[int(tok)]
        except (IndexError, TypeError):
            return None
    return getattr(node, tok, None)


def _resolve_to_node(root, parts):
    """Walk parts[0..n], return the last reached node or None if a step
    yielded None. parts[0] must be 'live_set'."""
    if not parts or parts[0] != "live_set":
        return None
    node = root
    for tok in parts[1:]:
        node = _step(node, tok)
        if node is None:
            return None
    return node


def execute(song: Any, msg: Dict[str, Any]) -> Dict[str, Any]:
    op = msg.get("op")
    path = msg.get("path", "")
    parts = path.split()

    if op == "get":
        if not parts or parts[0] != "live_set":
            return {"ok": False, "error": f"path must start with 'live_set', got '{path}'"}
        if len(parts) == 1:
            return {"ok": True, "value": _serialize(song)}
        parent = _resolve_to_node(song, parts[:-1])
        if parent is None:
            return {"ok": False, "error": f"unknown path: {path}"}
        leaf = parts[-1]
        if not hasattr(parent, leaf) and not (leaf.isdigit() and isinstance(parent, (list, tuple))):
            return {"ok": False, "error": f"no attribute '{leaf}' on {type(parent).__name__}"}
        try:
            value = _step(parent, leaf)
            return {"ok": True, "value": _serialize(value)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if op == "set":
        if not parts or parts[0] != "live_set":
            return {"ok": False, "error": f"path must start with 'live_set', got '{path}'"}
        parent = _resolve_to_node(song, parts[:-1])
        if parent is None:
            return {"ok": False, "error": f"unknown path: {path}"}
        try:
            setattr(parent, parts[-1], msg["value"])
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if op == "call":
        node = _resolve_to_node(song, parts)
        if node is None:
            return {"ok": False, "error": f"unknown path: {path}"}
        method = msg.get("method", "")
        fn = getattr(node, method, None)
        if not callable(fn):
            return {"ok": False, "error": f"no callable '{method}' on {type(node).__name__}"}
        try:
            result = fn(*msg.get("args", []))
            return {"ok": True, "value": _serialize(result)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": False, "error": f"unknown op '{op}'"}


def _serialize(value):
    """Convert Live API objects to JSON-safe values. For primitives this
    is identity. For complex objects, return repr() — the proto only needs
    primitive returns."""
    if isinstance(value, (int, float, str, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_serialize(v) for v in value]
    return repr(value)
