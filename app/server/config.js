'use strict';

// Single source of truth for runtime constants. Anything tunable lives here.
// Path constants tied to a specific module's filesystem layout (log files,
// endpoint dir, user config files) stay in their owner module — they're
// implementation details, not configuration.

// ── HTTP server ──────────────────────────────────────────────────────────
// Port that exposes the MCP endpoint + the device UI. Communicated to MCP
// clients via ~/.agent4live-ableton-mcp/endpoint.json. Changing this value breaks
// every previously-registered client config — only bump on a major version.
const PORT = 19845;

// ── MCP identity ─────────────────────────────────────────────────────────
// The name visible to clients ("claude mcp list" etc.).
const SERVER_NAME = 'agent4live-ableton-mcp';
// Single source of truth : package.json (at the repo root, two levels up
// from app/server/). esbuild inlines the JSON at build time so the bundle
// has the version baked in ; in dev mode, Node-for-Max resolves the
// relative require like any other JSON import.
const SERVER_VERSION = require('../../package.json').version;

// ── Timeouts ─────────────────────────────────────────────────────────────
// Single LOM request → response cycle. Empirically a healthy LOM op completes
// in <50ms ; 10s catches genuinely stuck calls without false-positiving on
// transient stalls.
const LOM_TIMEOUT_MS = 10000;
// execFile / execFileSync against external CLIs (claude / gemini / opencode)
// when probing or registering. Tight because these are local IPC.
const SUBPROCESS_TIMEOUT_MS = 5000;
// Ceiling on a single agent's full registration sequence (probe + maybe-add).
// Wider than SUBPROCESS_TIMEOUT_MS because some CLIs run `mcp list` then
// `mcp add` and each can spend a few seconds resolving its config files.
const AGENT_REGISTRATION_TIMEOUT_MS = 15000;

// ── Active / passive lifecycle cadences ──────────────────────────────────
// First passiveTick fires ~2s after entering passive mode. Same delay as
// activeBoot's LOM ping — Max needs ~2s to wire the LiveAPI bridge.
const PASSIVE_BOOT_DELAY_MS = 2000;
// Subsequent passiveTick cadence (retry-bind + scan refresh). 5s balances
// auto-takeover latency against scan cost.
const PASSIVE_TICK_MS = 5000;
// Delay before registering with agent CLIs after acquiring the port.
// Gives the HTTP server a beat to be ready when CLIs probe back.
const ACTIVE_BOOT_DELAY_MS = 500;
// Delay before pinging LOM at boot — Max wires LiveAPI lazily.
const ACTIVE_LOM_PING_DELAY_MS = 2000;

// ── Streaming SSE ────────────────────────────────────────────────────────
// Default throttle on LiveAPI observers. Sweet spot for tempo/volume/etc.
// Clients can override per-URI via ?throttle_ms=N in the live:// URI.
const DEFAULT_THROTTLE_MS = 100;

// ── UI ───────────────────────────────────────────────────────────────────
// Cap on the in-memory UI log buffer (FIFO rotation). 50 keeps a useful
// debug window without making the /ui/state poll heavy.
const MAX_UI_LOGS = 50;

// ── Auth ─────────────────────────────────────────────────────────────────
// Bytes of crypto-random for the Bearer token. 16 → 32 hex chars.
const TOKEN_BYTES = 16;

module.exports = {
  PORT,
  SERVER_NAME,
  SERVER_VERSION,
  LOM_TIMEOUT_MS,
  SUBPROCESS_TIMEOUT_MS,
  AGENT_REGISTRATION_TIMEOUT_MS,
  PASSIVE_BOOT_DELAY_MS,
  PASSIVE_TICK_MS,
  ACTIVE_BOOT_DELAY_MS,
  ACTIVE_LOM_PING_DELAY_MS,
  DEFAULT_THROTTLE_MS,
  MAX_UI_LOGS,
  TOKEN_BYTES,
};
