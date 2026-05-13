# What can agent4live do?

230 tools across 13 families:

| Family        | Scope                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `transport`   | Play/stop/continue, tempo, metronome, recording, tap, undo/redo                                      |
| `session`     | Tempo, time signature, scale (Live 12+), grooves, selection, swing, automation                       |
| `tracks`      | Volume/pan/sends, mute/solo/arm, routing, devices, master + returns, crossfader, take lanes          |
| `clips`       | Create/delete/fire, MIDI notes (add/replace/modify by id), warp markers, envelopes, quantize         |
| `scenes`      | Fire (with options), create/duplicate/delete, per-scene tempo + signature                            |
| `arrangement` | Song time, loop, punch, cue points, take lane clips                                                  |
| `racks`       | Audio/Instrument/Drum racks, chains, drum pads, macros, variations                                   |
| `instruments` | Simpler / Looper / Sample mode params + slicing                                                      |
| `application` | Control surfaces, view navigation (focus/show/hide/scroll/zoom), Hot-Swap toggle, dialog automation  |
| `browser`     | Load presets/instruments/effects/drum kits/samples programmatically (via Python extension)           |
| `tuning`      | Tuning systems (Live 12+) — read active microtonal grid, reference pitch, note-relative cents        |
| `meta`        | `get_usage_guide` — bundled Markdown skill that primes the agent with conventions, pitfalls, recipes |
| `raw`         | Direct LOM `get` / `set` / `call` for anything not covered by a semantic tool                        |

Plus **streaming SSE**: subscribe to LiveAPI observers via MCP resources for push notifications when tempo, track props, clip positions, etc. change in Live.

For the full list of available tools, run `grep -h "^  defineTool" server/tools/*.js`.
