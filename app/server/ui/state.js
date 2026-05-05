'use strict';

const Max = require('max-api');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { PORT, MAX_UI_LOGS } = require('../config');

// In dev (Node for Max), device/index.js registers a require.extensions['.html']
// hook so this require() works. In prod (esbuild bundle), the text loader
// inlines active.html as a string literal at build time. Same line, both modes.
const UI_HTML = require('./active.html');
const UI_PASSIVE_HTML = require('./passive.html');
// Pushed as a base64 data URL at the very start of node boot to override any
// stale jweb cache (e.g. a `data:text/html` passive view from a previous
// session) before we know whether we'll end up active or passive.
const UI_LOADING_HTML = require('./loading.html');

// Version is read from package.json so there's a single source of truth.
// `npm version patch|minor|major` updates the file, the next boot picks it up,
// and the UI footer reflects it without any extra bookkeeping.
const { version: VERSION } = require('../../../package.json');

const LOG_DIR = path.join(os.homedir(), '.agent4live-ableton-mcp');
const LOG_FILE = path.join(LOG_DIR, 'runtime.log');

/**
 * Append a timestamped line to the runtime log file and post it to the Max
 * console. Best-effort writes — filesystem failures are swallowed because
 * logging itself must not crash the device.
 *
 * @param {string} message - Free-form text. Already prefixed by [MCP] in Max.
 */
function log(message) {
  const line = `[${new Date().toISOString()}] [pid=${process.pid}] ${message}\n`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
  Max.post(`[MCP] ${message}`);
}

/**
 * Two-digit zero-pad for clock display ("9" → "09"). Cheaper than
 * String.prototype.padStart on hot paths.
 *
 * @param {number} num - Non-negative integer 0..99.
 * @returns {string}
 */
function pad2(num) {
  return num < 10 ? '0' + num : String(num);
}

/**
 * Mutable global UI state. Polled by the device's jweb at /ui/state every
 * 500ms. Don't read or mutate `token` from anything that can be exposed to
 * the UI — it's stripped in the /ui/state route.
 */
const uiState = {
  mode: 'active',
  activePeer: null,
  connected: false,
  port: PORT,
  liveApiOk: false,
  latencyMs: 0,
  logs: [],
  // Bearer token for /mcp auth. Populated by setupDiscovery() at boot.
  // Not exposed via /ui/state — see server/index.js's state filter.
  token: null,
  agents: {
    claudeCode: { detected: false, registered: false },
    opencode: { detected: false, registered: false },
    codex: { detected: false, registered: false },
    gemini: { detected: false, registered: false },
  },
  // null = the device just booted and updateCompanionStatus() hasn't returned
  // yet. The UI uses null as a "loading" signal so it doesn't flash Modal A
  // "One-time setup" before knowing the real install state. Set to a real
  // {scriptInstalled, pingOk} object by index.js after each companion check
  // (boot, /companion/install, /companion/recheck).
  companionStatus: null,
  // package.json version, displayed as a discreet footer in the UI.
  version: VERSION,
};

let uiPageLoaded = false;

/**
 * Push a neutral "Loading..." placeholder to the jweb. Called once at the
 * very start of node boot to override any stale URL the jweb might still
 * hold from a previous session (e.g. a data:text/html passive view) — so the
 * user never sees a flash of the old view before the real one is decided.
 */
function emitLoadingUi() {
  const dataUrl =
    'data:text/html;base64,' + Buffer.from(UI_LOADING_HTML, 'utf8').toString('base64');
  Max.outlet('ui_status', 'url', dataUrl).catch(() => {});
}

/**
 * Tell Max which URL to load in the device's jweb. Called whenever
 * `connected` flips. Idempotent: re-emits only on edge transitions.
 */
function uiRender() {
  if (uiState.connected && !uiPageLoaded) {
    uiPageLoaded = true;
    Max.outlet('ui_status', 'url', `http://127.0.0.1:${uiState.port}/ui`).catch(() => {});
  }
  if (!uiState.connected) {
    uiPageLoaded = false;
  }
}

/**
 * Push a tool-call entry to the UI log buffer (capped at MAX_UI_LOGS, FIFO).
 * Called by every tool via defineTool() — both on success and on error.
 *
 * @param {string} tool - Tool label (e.g. "set_tempo(140)" or "fire_clip").
 * @param {boolean} isError - true if the tool threw.
 */
function uiLog(tool, isError) {
  const now = new Date();
  const ts = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
  uiState.logs.push({ ts, tool, result: isError ? 'error' : 'ok', isError: !!isError });
  if (uiState.logs.length > MAX_UI_LOGS) uiState.logs = uiState.logs.slice(-MAX_UI_LOGS);
}

/**
 * Return the active-mode HTML served at GET /ui. Currently a thin wrapper —
 * exists so the future version-checker can inject the bundled version into
 * the served HTML without forcing every caller to know about the template.
 *
 * @returns {string} Complete HTML document.
 */
function buildUiHtml() {
  return UI_HTML;
}

const HTML_ESCAPES = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Render the passive-mode HTML, with the active peer's track name injected
 * (XSS-safe). Used when the device boots into passive mode (another agent4live
 * already holds the port on this machine).
 *
 * @param {string|null} trackName - Peer's track name, or null when unknown.
 * @returns {string} Complete HTML document.
 */
function buildPassiveUiHtml(trackName) {
  const safe = trackName
    ? String(trackName).replace(/[<>&"']/g, (char) => HTML_ESCAPES[char])
    : 'elsewhere in this Set';
  return UI_PASSIVE_HTML.replace('__TRACK_NAME__', safe).replace('__VERSION__', VERSION);
}

module.exports = {
  uiState,
  log,
  pad2,
  uiRender,
  uiLog,
  buildUiHtml,
  buildPassiveUiHtml,
  emitLoadingUi,
};
