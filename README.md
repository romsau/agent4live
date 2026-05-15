# AGENT4LIVE

Agent4live is a Max for Live device that embeds a Model Context Protocol server. Drop it on a track and any MCP-compatible agent — Claude Code, Gemini CLI, OpenCode — gets **230 tools** to control your set: tempo, tracks, clips, devices, racks, automation, MIDI notes, Browser (load presets / instruments / drum kits), tuning systems, view navigation, dialogs, plus live SSE streams of LiveAPI observers.

No external server. No environment variables. No config files to edit.

The device auto-registers itself in your agent's MCP config the first time you drop it.

**Website:** [agent4live-7cfed.web.app](https://agent4live-7cfed.web.app/)

<a href="https://buymeacoffee.com/romainsauvez" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

## Features

- [**What can it do?**](docs/features/CAPABILITIES.md) — 230 tools across 13 families + streaming SSE
- [**What can't it do?**](docs/features/LIMITATIONS.md) — the handful of things Live's LOM doesn't expose

---

## Requirements

- **Ableton Live 12 Suite**
- **Max 9** (bundled with Live 12 Suite)
- **macOS** (Windows soon)
- Supported agents:
  - [Claude Code](https://claude.com/claude-code)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - [OpenCode](https://opencode.ai)

  > _Codex CLI was temporarily removed in v1.3.0._

---

## Quickstart

About 30 seconds the first time, then nothing to do ever again.

1. **Download** `dist/agent4live.amxd`.
2. **Drop it on a track in Live** (any track works). The device walks you through a few quick steps inside its panel:
   1. **Click "Install"** — agent4live drops a small helper file into your Ableton library.
   2. **Restart Live** — needed once so Ableton picks the helper up.
   3. **Turn the helper on** — open Live's Preferences → Control Surfaces, and on any free row pick `agent4live`.
   4. **Pick your agent** — tick the CLI you use (Claude Code / Gemini / OpenCode). agent4live takes care of the connection.
3. **Open a chat** with your agent and ask anything about your set:

   ```
   You:    What's the tempo and how many tracks do I have?
   Agent:  120 BPM, 4 tracks, 3 scenes…
   ```

Done. Next time you drop the device on another set, only the agent picker shows up — the rest stays installed.

> **Tired of confirming each tool call?** Add `"mcp__agent4live-ableton-mcp__*"` to your agent's allowlist (e.g. `~/.claude/settings.json` for Claude Code) to pre-approve all 230 tools in one line.

---

## Development

```bash
git clone <repo>
cd agent4live
npm install      # runtime deps + tooling (eslint, prettier, esbuild)
```

> **Build-time requirement:** `python3.11` on the dev box (`brew install python@3.11`). `npm run build` invokes it once to compile the extension Remote Script to `.pyc`, which esbuild then embeds as raw bytes inside `dist/staging/index.js`. End users never need Python.

### Run in dev mode

Drag-and-drop `app/agent4live.amxd` (the source — not the one in `dist/`) onto a Live track. Edits to `app/server/` reload on next agent call. For invasive changes (new files, top-level rewrites), redrop the device.

### Iterate on the UI in Chrome

The device's UI panel inside Live is a tiny 360×170 viewport — too cramped to develop comfortably, and rebuilding the device on every tweak is slow. The dev server serves the exact same HTML in a regular Chrome tab with hot reload, full-size DevTools, and fixtures for every UI state (default view, agent picker modal, install modal, errors, etc.). It's the easiest way to test UI changes during development without ever touching Live.

```bash
npm run dev      # http://127.0.0.1:19846/
```

### Build the distribution `.amxd`

```bash
npm run build    # generates dist/staging/
```

Then in Max:

1. Open `dist/staging/agent4live.amxd`
2. Click **Freeze Device** in the M4L toolbar
3. **File → Save As** → `dist/agent4live.amxd`

---

## Security

`/mcp` requires a **Bearer token** auto-generated at first boot, persisted at `~/.agent4live-ableton-mcp/endpoint.json` (chmod 600). Survives device restarts so already-registered agents stay valid.

Only **localhost-origin** requests are accepted (CSRF defense).

Agent CLIs are registered with the token automatically — you don't see it.

When you drop the device and complete the setup, agent4live touches the following on your disk — and nothing else:

| Location                                              | What                                                                                                                                                                                                                                                                                     | When                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `<User Library>/Remote Scripts/agent4live/`           | Small Python helper Ableton needs to expose the Browser API to the device. The compiled bytecode is bundled inside the `.amxd` — you don't need Python installed. `<User Library>` is read from Live's `Library.cfg` ; defaults to `~/Music/Ableton/User Library/` on standard installs. | Modal "Install"                  |
| `~/.agent4live-ableton-mcp/endpoint.json` (chmod 600) | Server URL + Bearer token, so already-registered agents reconnect on next boot.                                                                                                                                                                                                          | First boot                       |
| `~/.agent4live-ableton-mcp/preferences.json`          | Records which agents you ticked in the consent modal, so the choice persists across sessions.                                                                                                                                                                                            | Consent modal                    |
| `~/.claude.json`, `~/.config/opencode/opencode.json`  | MCP server entry added to the configs of the agents you ticked. Gemini is configured through its own `mcp add` CLI command.                                                                                                                                                              | Consent modal                    |
| `~/.claude/skills/agent4live/SKILL.md`                | Skill that primes Claude Code with agent4live conventions and pitfalls.                                                                                                                                                                                                                  | Consent modal (Claude Code only) |

Untick an agent in the modal at any time to remove its config entry cleanly.

---

## Documentation

| File                                                 | Contains                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)       | Internal architecture, runtime contracts, build pipeline, invariants to respect |
| [`docs/LOM_NOTES.md`](docs/LOM_NOTES.md)             | LOM conventions + catalog of what is intentionally NOT exposed (and why)        |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Common errors + fixes                                                           |

---

## License

MIT — see [`LICENSE`](LICENSE).
