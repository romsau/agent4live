"""ControlSurface package entry point for the HTTP-in-Live prototype.

Live calls `create_instance(c_instance)` when the user assigns the
'agent4live_proto' Remote Script in Preferences → Link/Tempo/MIDI.

We keep this file deliberately minimal :
  - Insert _vendor/ on sys.path so Live's bundled Python finds mcp,
    uvicorn, etc.
  - Defer the actual ControlSurface import to inside create_instance,
    so this package stays importable from pytest (which has no
    _Framework module).
"""

from __future__ import absolute_import, print_function, unicode_literals

import os
import sys

_HERE = os.path.dirname(__file__)
_VENDOR = os.path.join(_HERE, "_vendor")
if _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)


def create_instance(c_instance):
    """Entry point invoked by Live to bootstrap the Remote Script.

    Lazy-imports the ControlSurface so that simply importing this
    package (e.g. from pytest) does not require Live's bundled Python.
    """
    from .control_surface import Agent4LiveProto
    return Agent4LiveProto(c_instance)
