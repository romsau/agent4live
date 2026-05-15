"""Tests for lom_exec — the main-thread LOM executor.

We can't import the real Live API, so the executor takes a `song` object
as a dependency. Tests inject a fake song.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "remote_script"))

from agent4live_proto.lom_exec import execute


class FakeTrack:
    def __init__(self):
        self.name = "Track 1"


class FakeSong:
    def __init__(self):
        self.tempo = 124.0
        self.tracks = [FakeTrack()]
        self._created = []

    def create_audio_track(self, index: int) -> FakeTrack:
        t = FakeTrack()
        t.name = f"Created at {index}"
        self.tracks.append(t)
        self._created.append(t)
        return t

    def delete_track(self, index: int) -> None:
        del self.tracks[index]


def test_get_tempo():
    song = FakeSong()
    out = execute(song, {"op": "get", "path": "live_set tempo"})
    assert out == {"ok": True, "value": 124.0}


def test_set_tempo():
    song = FakeSong()
    out = execute(song, {"op": "set", "path": "live_set tempo", "value": 130.0})
    assert out["ok"] is True
    assert song.tempo == 130.0


def test_call_create_audio_track():
    song = FakeSong()
    out = execute(song, {
        "op": "call",
        "path": "live_set",
        "method": "create_audio_track",
        "args": [-1],
    })
    assert out["ok"] is True
    assert len(song.tracks) == 2


def test_unknown_path_returns_error():
    song = FakeSong()
    out = execute(song, {"op": "get", "path": "live_set foobar"})
    assert out["ok"] is False
    assert "unknown" in out["error"].lower() or "no attribute" in out["error"].lower()


def test_unknown_op_returns_error():
    song = FakeSong()
    out = execute(song, {"op": "WAT", "path": "live_set tempo"})
    assert out["ok"] is False
    assert "op" in out["error"].lower()
