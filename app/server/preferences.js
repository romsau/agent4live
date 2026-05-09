'use strict';

// User consent persistence for agent CLI auto-registration.
//
// The device used to register itself in every detected CLI (Claude Code, Codex,
// Gemini, OpenCode) automatically at boot — no consent. This module flips the
// model to opt-in: the user's choice (per agent) is persisted in
// ~/.agent4live-ableton-mcp/preferences.json (chmod 600). At every boot the
// device only re-applies what the user explicitly consented to.
//
// Schema v1:
//   { "version": 1,
//     "agents": {
//       "claudeCode": { "consented": true,
//                       "consented_at": "2026-05-03T14:20:00.000Z",
//                       "url_at_consent": "http://127.0.0.1:19845/mcp" },
//       "codex":    { "consented": false },
//       ... } }
//
// Migration: when an old user updates the device, we scan their existing CLI
// configs for entries pointing at localhost. If found we silently mark
// `consented: true` so they don't lose access — they already implicitly
// granted it via the previous version. The four CLIs we cover all expose a
// flat config file readable from disk (no bin-in-PATH required) :
//   - Claude Code  → ~/.claude.json                 (JSON, mcpServers[name].url)
//   - OpenCode     → ~/.config/opencode/opencode.json (JSON, mcp[name].url)
//   - Gemini CLI   → ~/.gemini/settings.json        (JSON, mcpServers[name].httpUrl)
//   - Codex CLI    → ~/.codex/config.toml           (TOML, [mcp_servers.<name>].url)
//
// The Codex branch uses a stateful line scanner instead of a TOML parser —
// the migration only needs one section and one url, so a regex+section-tracker
// is enough and keeps the project zero-extra-deps.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { SERVER_NAME } = require('./config');

const PREFERENCES_DIR = path.join(os.homedir(), '.agent4live-ableton-mcp');
const PREFERENCES_FILE = path.join(PREFERENCES_DIR, 'preferences.json');
const CLAUDE_CONFIG = path.join(os.homedir(), '.claude.json');
const OPENCODE_CONFIG = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
const GEMINI_CONFIG = path.join(os.homedir(), '.gemini', 'settings.json');
const CODEX_CONFIG = path.join(os.homedir(), '.codex', 'config.toml');

const CURRENT_VERSION = 1;
const AGENTS = ['claudeCode', 'codex', 'gemini', 'opencode'];

// Aliases for AGENT4LIVE_AUTO_REGISTER env var: short forms map to internal keys.
const ENV_ALIAS = {
  claude: 'claudeCode',
  claudecode: 'claudeCode',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
};

/**
 * Build a fresh preferences struct (no agents consented).
 *
 * @returns {{ version: number, agents: object }}
 */
function defaultPreferences() {
  return { version: CURRENT_VERSION, agents: {} };
}

/**
 * Load preferences.json. Returns null if missing, malformed, or schema-mismatched.
 *
 * @returns {{ version: number, agents: object }|null}
 */
function loadPreferences() {
  if (!fs.existsSync(PREFERENCES_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(PREFERENCES_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!parsed.agents || typeof parsed.agents !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * Persist preferences with chmod 600. Creates the parent directory if missing.
 *
 * @param {{ version: number, agents: object }} prefs
 */
function savePreferences(prefs) {
  fs.mkdirSync(PREFERENCES_DIR, { recursive: true });
  fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(prefs, null, 2), { mode: 0o600 });
  // writeFileSync's `mode` is honored only on file creation. Force the perm
  // again in case the file pre-existed with a looser mode.
  try {
    fs.chmodSync(PREFERENCES_FILE, 0o600);
  } catch (_) {}
}

/**
 * Mark an agent's consent state. When consenting, records timestamp + URL
 * snapshot ; when revoking, drops the metadata.
 *
 * @param {{ agents?: object }} prefs - Mutated in-place.
 * @param {string} agent
 * @param {boolean} consented
 * @param {string} [url] - Required when consenting, ignored when revoking.
 * @returns {{ agents: object }}
 */
function markConsent(prefs, agent, consented, url) {
  if (!AGENTS.includes(agent)) {
    throw new Error(`unknown agent: ${agent} (expected one of ${AGENTS.join(', ')})`);
  }
  if (!prefs.agents) prefs.agents = {};
  prefs.agents[agent] = consented
    ? {
        consented: true,
        consented_at: new Date().toISOString(),
        url_at_consent: url,
      }
    : { consented: false };
  return prefs;
}

/**
 * Whether to show the welcome modal at boot. True if no preferences file exists
 * or no agent has been recorded yet.
 *
 * @param {object|null} prefs
 * @returns {boolean}
 */
function isFirstBoot(prefs) {
  return !prefs || !prefs.agents || Object.keys(prefs.agents).length === 0;
}

/**
 * Scan the user's existing CLI configs for entries pointing at localhost and
 * carrying our SERVER_NAME. Returns a map of agents that already had us
 * registered — those will be auto-consented at boot, no modal needed.
 *
 * Only Claude + OpenCode are scanned (flat JSON configs). Codex/Gemini store
 * their MCP entries in formats we'd need to shell out to read.
 *
 * @returns {{ claudeCode?: boolean, opencode?: boolean }}
 */
function migrateFromExistingConfigs() {
  const result = {};

  if (fs.existsSync(CLAUDE_CONFIG)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CLAUDE_CONFIG, 'utf8'));
      const entry = cfg && cfg.mcpServers && cfg.mcpServers[SERVER_NAME];
      if (entry && typeof entry.url === 'string' && _isLocalhostUrl(entry.url)) {
        result.claudeCode = true;
      }
    } catch (_) {}
  }

  if (fs.existsSync(OPENCODE_CONFIG)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(OPENCODE_CONFIG, 'utf8'));
      const entry = cfg && cfg.mcp && cfg.mcp[SERVER_NAME];
      if (entry && typeof entry.url === 'string' && _isLocalhostUrl(entry.url)) {
        result.opencode = true;
      }
    } catch (_) {}
  }

  if (fs.existsSync(GEMINI_CONFIG)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(GEMINI_CONFIG, 'utf8'));
      const entry = cfg && cfg.mcpServers && cfg.mcpServers[SERVER_NAME];
      if (entry && typeof entry.httpUrl === 'string' && _isLocalhostUrl(entry.httpUrl)) {
        result.gemini = true;
      }
    } catch (_) {}
  }

  if (fs.existsSync(CODEX_CONFIG)) {
    try {
      const toml = fs.readFileSync(CODEX_CONFIG, 'utf8');
      const url = _extractCodexUrl(toml, SERVER_NAME);
      if (url && _isLocalhostUrl(url)) {
        result.codex = true;
      }
    } catch (_) {}
  }

  return result;
}

/**
 * Apply AGENT4LIVE_AUTO_REGISTER env var (comma-separated agent list) to a
 * preferences struct. Used by CI / headless setups to bypass the modal.
 *
 * @param {{ agents?: object }} prefs - Mutated in-place.
 * @param {string} url
 * @returns {{ agents: object }}
 */
function applyAutoRegisterEnv(prefs, url) {
  const env = process.env.AGENT4LIVE_AUTO_REGISTER;
  if (!env) return prefs;
  const tokens = env
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const tok of tokens) {
    const agent = ENV_ALIAS[tok];
    if (agent) markConsent(prefs, agent, true, url);
  }
  return prefs;
}

/**
 * Strict localhost-URL check. Only `http(s)://127.0.0.1` or `localhost`
 * (with optional port + path) qualifies — guards the migration from
 * accidentally picking up a remote mcp server with our SERVER_NAME.
 *
 * @param {string} url
 * @returns {boolean}
 */
function _isLocalhostUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/.*)?$/.test(url);
}

/**
 * Extract the `url = "..."` value from a `[mcp_servers.<serverName>]` section
 * of a Codex config.toml. Stateful line scan: tracks the current section
 * header, returns the first `url` line inside the matching section, returns
 * null if the section is absent or has no url. No external TOML parser to
 * keep the .amxd freeze zero-dep.
 *
 * @param {string} toml - Raw config.toml content.
 * @param {string} serverName - Section key to match (after `mcp_servers.`).
 * @returns {string|null}
 */
function _extractCodexUrl(toml, serverName) {
  const target = `[mcp_servers.${serverName}]`;
  let inSection = false;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inSection = line === target;
      continue;
    }
    if (inSection) {
      const m = line.match(/^url\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  return null;
}

module.exports = {
  PREFERENCES_FILE,
  PREFERENCES_DIR,
  CURRENT_VERSION,
  AGENTS,
  defaultPreferences,
  loadPreferences,
  savePreferences,
  markConsent,
  isFirstBoot,
  migrateFromExistingConfigs,
  applyAutoRegisterEnv,
  _isLocalhostUrl,
  _extractCodexUrl,
};
