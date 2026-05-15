"""Thread-safe handoff between the asyncio loop and Live's main thread.

The asyncio side calls `await bridge.submit(msg)` to dispatch a LOM op.
Internally:
  1. A `threading.Event` + a result slot are paired with the message and
     pushed onto a `queue.Queue` (thread-safe).
  2. The asyncio coroutine awaits a `loop.run_in_executor(...)` call that
     blocks on `event.wait(timeout)` in a thread-pool worker.
  3. Live's main thread, on its `update_display()` ~30 Hz tick, calls
     `bridge.drain(handler, max_items)` which pops messages, runs the
     handler, fills the slot, sets the event.

If the timeout fires before drain happens, the submit returns an error
response — Live may have been unresponsive (e.g. modal dialog, freeze).
"""

import asyncio
import queue
import threading
import traceback
from typing import Any, Callable, Dict


class Bridge:
    def __init__(self, main_thread_timeout_s: float = 30.0) -> None:
        self._queue: queue.Queue = queue.Queue()
        self._timeout = main_thread_timeout_s

    def queue_depth(self) -> int:
        return self._queue.qsize()

    async def submit(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        slot: Dict[str, Any] = {"event": threading.Event(), "result": None}
        self._queue.put((msg, slot))
        loop = asyncio.get_running_loop()
        ok = await loop.run_in_executor(None, slot["event"].wait, self._timeout)
        if not ok:
            return {
                "ok": False,
                "error": f"main-thread dispatch timed out after {self._timeout}s",
            }
        return slot["result"]

    def drain(self, handler: Callable[[Dict[str, Any]], Dict[str, Any]], max_items: int) -> int:
        """Called from Live's main thread. Pops up to `max_items` messages,
        runs `handler(msg)` synchronously for each, fills the slot, fires
        the event. Returns the number drained.
        """
        drained = 0
        for _ in range(max_items):
            try:
                msg, slot = self._queue.get_nowait()
            except queue.Empty:
                return drained
            try:
                slot["result"] = handler(msg)
            except Exception as e:
                slot["result"] = {
                    "ok": False,
                    "error": str(e),
                    "trace": traceback.format_exc(),
                }
            slot["event"].set()
            drained += 1
        return drained
