# What can't agent4live do?

A few things Live's LOM doesn't expose — calling these out so the agent (and you) don't waste time trying:

| Action                                               | Why                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Freeze / Unfreeze a track                            | `Track.is_frozen` is read-only — no LOM method to toggle freeze                              |
| Copy-paste clips between non-adjacent slots          | No clipboard primitive — use `duplicate_clip_to_slot` (adjacent) or read+write notes         |
| Sub-10 ms scheduling for live performance            | LOM round-trip is ~10–50 ms — use MIDI Clock or Ableton Link instead                         |
| Rename the master track                              | LOM SET on master's `name` is silently ignored                                               |
| Toggle `exclusive_arm` / `exclusive_solo`            | Mirrored from Preferences — LOM SET ignored, change them in Live's Prefs UI                  |
| Read or set track monitoring state (In / Auto / Off) | Not exposed in the Live 12 LOM corpus                                                        |
| Delete a take lane                                   | No `delete_take_lane` method — create + rename OK, deletion is UI-only                       |
| Toggle the Tempo Follower (Live 12)                  | Documented bool but read-only — toggle from Live's transport bar                             |
| Clear a clip's groove (reset to "None")              | Setting `Clip.groove = 0` is silently ignored — clear via Clip > Groove dropdown             |
| Set `Device.is_active` directly                      | `is_active` is derived/read-only — use `set_device_active` (toggles `parameters[0]`)         |
| Edit name/note/mute/solo on empty drum pads          | Empty pads silently ignore SETs — load samples / instruments first                           |
| Move a cue point in time after creation              | `CuePoint.time` setter is silently ignored — delete + recreate at the new position           |
| Toggle `back_to_arranger` directly                   | Setter ignored — call the `back_to_arranger()` method instead (returns playback to arranger) |

For the full technical detail (LOM paths, empirical findings, version notes), see [`../LOM_NOTES.md`](../LOM_NOTES.md).
