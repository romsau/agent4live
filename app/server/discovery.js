'use strict';

// Discovery + auto-registration with agent CLIs (Claude / Codex / Gemini /
// OpenCode). On boot, the active device:
//   1. Generates (or reloads) a Bearer token.
//   2. Writes ~/.agent4live-ableton-mcp/endpoint.json with the URL + token (mode 0o600).
//   3. Registers itself with each detected CLI's MCP config.
//
// Each CLI has its own registration mechanism — Claude/Codex/Gemini use
// their own `mcp add` commands ; OpenCode is JSON-merged into its config
// because its CLI is interactive.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { auditLog, hashToken } = require('./audit');
const { execFileSync, execFile } = require('child_process');
const {
  SERVER_NAME,
  SUBPROCESS_TIMEOUT_MS,
  AGENT_REGISTRATION_TIMEOUT_MS,
  TOKEN_BYTES,
} = require('./config');
const { uiState, log } = require('./ui/state');
const { SKILL_FILE_BODY } = require('./skill');

const OPENCODE_CONFIG = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
const ENDPOINT_DIR = path.join(os.homedir(), '.agent4live-ableton-mcp');
const ENDPOINT_FILE = path.join(ENDPOINT_DIR, 'endpoint.json');

// Claude Code is the only one of the four supported agents that has a native
// skill mechanism. For Codex / Gemini / OpenCode, the MCP tool
// `get_usage_guide` (with its prominent "Read this once" description) covers
// the same role at session start without touching their config files.
const CLAUDE_SKILL_DIR = path.join(os.homedir(), '.claude', 'skills', 'agent4live');
const CLAUDE_SKILL_FILE = path.join(CLAUDE_SKILL_DIR, 'SKILL.md');

/**
 * Load the existing Bearer token from endpoint.json, or generate a fresh
 * one if missing/invalid. Persisting the token across restarts keeps
 * pre-registered CLI configs working when the device is re-dropped.
 *
 * @returns {string} 32-character hex token.
 */
function loadOrGenerateToken() {
  if (fs.existsSync(ENDPOINT_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8'));
      if (parsed && typeof parsed.token === 'string' && /^[a-f0-9]{32,}$/.test(parsed.token)) {
        return parsed.token;
      }
      log(`endpoint.json present but token field invalid — regenerating`);
    } catch (err) {
      log(`endpoint.json malformed (${err.message}) — regenerating token`);
    }
  }
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

// uiKey → CLI binary name. Drives both `detectAgents` (boot-time probe of all
// 4) and the per-agent helpers below (e.g. detectClaude).
const AGENT_BINS = {
  claudeCode: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
};

/**
 * Probe a single agent's binary on this machine and update its uiState entry.
 * Used by detectAgents() at boot and detectClaude() for the legacy single-probe
 * code path that callers still expect.
 *
 * @param {string} uiKey - Key in uiState.agents (e.g. 'claudeCode').
 * @param {string} binName - CLI binary name to probe (e.g. 'claude').
 */
function detectAgent(uiKey, binName) {
  const binaryPath = resolveBin(binName);
  if (binaryPath) {
    uiState.agents[uiKey].detected = true;
    log(`${binName} found at ${binaryPath}`);
  } else {
    log(`${binName} not found in PATH`);
  }
}

/**
 * Probe whether the `claude` CLI is on this machine. Updates uiState so
 * the UI can light its Claude card green at boot.
 */
function detectClaude() {
  detectAgent('claudeCode', 'claude');
}

/**
 * Probe all 4 supported agent CLIs (Claude / Codex / Gemini / OpenCode) and
 * update their uiState entries. Called once at boot so the consent modal
 * shows the actual install state of every agent — without this, only Claude
 * was probed and Codex/Gemini/OpenCode appeared grayed-out + linking to
 * GitHub even when the user had them installed.
 */
function detectAgents() {
  for (const [uiKey, binName] of Object.entries(AGENT_BINS)) {
    detectAgent(uiKey, binName);
  }
}

/**
 * Persist endpoint.json with the given token. Returns true on success, false
 * on filesystem failure. Always writes mode 0o600 ; a double-write (`mode` +
 * `chmodSync`) covers both "file freshly created" and "file pre-existed
 * with looser perms".
 *
 * @param {number} port
 * @param {string} token
 * @returns {boolean}
 */
function writeEndpointFile(port, token) {
  const url = `http://127.0.0.1:${port}/mcp`;
  try {
    fs.mkdirSync(ENDPOINT_DIR, { recursive: true });
    fs.writeFileSync(
      ENDPOINT_FILE,
      JSON.stringify({ url, token, version: '0.2.0', pid: process.pid }),
      { mode: 0o600 },
    );
    try {
      fs.chmodSync(ENDPOINT_FILE, 0o600);
    } catch (_) {}
    return true;
  } catch (err) {
    log(`Discovery file write failed: ${err.message}`);
    return false;
  }
}

/**
 * Write endpoint.json (URL + token). Returns the token so the caller can push
 * it to uiState. Does NOT register with any CLI — that's now opt-in via
 * setupConsentedClients() / registerOne(), gated by user consent.
 *
 * @param {number} port
 * @returns {string|null} Token, or null if the endpoint file write failed.
 */
function setupDiscovery(port) {
  const token = loadOrGenerateToken();
  return writeEndpointFile(port, token) ? token : null;
}

/**
 * Force-generate a fresh Bearer token and persist it. Caller is expected to
 * push the new token to uiState and propagate to CLI configs via
 * setupConsentedClients() — this function only handles disk persistence.
 *
 * Used by POST /preferences/rotate-token (Gap D) to let a user invalidate
 * a leaked token without restarting the device.
 *
 * @param {number} port
 * @returns {string|null} New token, or null if disk write failed.
 */
function regenerateToken(port) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  return writeEndpointFile(port, token) ? token : null;
}

/**
 * Register (or re-register) the device in Claude Code's MCP config.
 * No-op when the entry already matches the desired URL + token.
 *
 * @param {string} url
 * @param {string} token
 */
function registerWithClaude(url, token) {
  const claudeConfig = path.join(os.homedir(), '.claude.json');
  const headerValue = `Authorization: Bearer ${token}`;
  let existingClaude = null;
  if (fs.existsSync(claudeConfig)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
      existingClaude = cfg?.mcpServers?.[SERVER_NAME] || null;
    } catch (err) {
      log(`~/.claude.json unreadable (${err.message}) — treating as if no entry exists`);
    }
  }
  // Re-register if token rotated, the URL changed, or the entry is missing.
  const needRegister =
    !existingClaude ||
    existingClaude.url !== url ||
    existingClaude.headers?.Authorization !== `Bearer ${token}`;

  if (!needRegister) {
    uiState.agents.claudeCode.registered = true;
    return;
  }

  const claudeBin = resolveBin('claude');
  if (!claudeBin) {
    log(
      `Auto-register skipped (claude not found) — run: claude mcp add ${SERVER_NAME} --transport http ${url} --scope user --header "${headerValue}"`,
    );
    return;
  }
  if (existingClaude) {
    try {
      execFileSync(claudeBin, ['mcp', 'remove', SERVER_NAME, '--scope', 'user'], {
        stdio: 'ignore',
        timeout: SUBPROCESS_TIMEOUT_MS,
      });
    } catch (_) {}
  }
  try {
    execFileSync(
      claudeBin,
      [
        'mcp',
        'add',
        SERVER_NAME,
        '--transport',
        'http',
        url,
        '--scope',
        'user',
        '--header',
        headerValue,
      ],
      { stdio: 'ignore', timeout: SUBPROCESS_TIMEOUT_MS },
    );
    uiState.agents.claudeCode.registered = true;
    log('Auto-registered with Claude Code (with auth)');
  } catch (err) {
    log(
      `Auto-register failed (${err.code || err.message}) — run: claude mcp add ${SERVER_NAME} --transport http ${url} --scope user --header "${headerValue}"`,
    );
  }
}

// Unregister from each CLI on teardown. Best-effort: a hanging CLI must not
// block process exit, so each call has a tight timeout and errors are swallowed.
// If unregister fails, the next drop's `setupAllClients` will overwrite the
// stale entry anyway — orphans are recoverable, hung shutdowns are not.
const TEARDOWN_SUBPROCESS_TIMEOUT_MS = 2000;

/**
 * Remove the Claude Code MCP entry. No-op if the binary isn't found.
 *
 * @returns {Promise<void>}
 */
async function unregisterFromClaude() {
  const binaryPath = resolveBin('claude');
  if (!binaryPath) return;
  try {
    await runCmd(binaryPath, ['mcp', 'remove', SERVER_NAME, '--scope', 'user'], {
      timeout: TEARDOWN_SUBPROCESS_TIMEOUT_MS,
    });
    uiState.agents.claudeCode.registered = false;
    log('claude: unregistered');
  } catch (err) {
    log(`claude unregister failed (best-effort): ${err.message}`);
  }
}

/**
 * Remove the Codex CLI MCP entry. No-op if the binary isn't found.
 *
 * @returns {Promise<void>}
 */
async function unregisterCodex() {
  const binaryPath = resolveBin('codex');
  if (!binaryPath) return;
  try {
    await runCmd(binaryPath, ['mcp', 'remove', SERVER_NAME], {
      timeout: TEARDOWN_SUBPROCESS_TIMEOUT_MS,
    });
    uiState.agents.codex.registered = false;
    log('codex: unregistered');
  } catch (err) {
    log(`codex unregister failed (best-effort): ${err.message}`);
  }
}

/**
 * Remove the Gemini CLI MCP entry. No-op if the binary isn't found.
 *
 * @returns {Promise<void>}
 */
async function unregisterGemini() {
  const binaryPath = resolveBin('gemini');
  if (!binaryPath) return;
  try {
    await runCmd(binaryPath, ['mcp', 'remove', SERVER_NAME, '--scope', 'user'], {
      timeout: TEARDOWN_SUBPROCESS_TIMEOUT_MS,
    });
    uiState.agents.gemini.registered = false;
    log('gemini: unregistered');
  } catch (err) {
    log(`gemini unregister failed (best-effort): ${err.message}`);
  }
}

/**
 * Strip the agent4live entry from OpenCode's JSON config. No-op if the
 * config file is missing, unreadable, or doesn't contain our entry. Sync
 * because OpenCode has no driveable CLI for this — same pattern as
 * registerOpenCode.
 */
function unregisterOpenCode() {
  if (!fs.existsSync(OPENCODE_CONFIG)) return;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(OPENCODE_CONFIG, 'utf8'));
  } catch (err) {
    log(`opencode config unreadable on teardown (${err.message}) — skipping unregister`);
    return;
  }
  if (!cfg?.mcp?.[SERVER_NAME]) return;
  delete cfg.mcp[SERVER_NAME];
  try {
    fs.writeFileSync(OPENCODE_CONFIG, JSON.stringify(cfg, null, 2));
    uiState.agents.opencode.registered = false;
    log('opencode: unregistered');
  } catch (err) {
    log(`opencode unregister failed: ${err.message}`);
  }
}

/**
 * Drop endpoint.json AND unregister from every CLI we registered with.
 * Called on graceful shutdown so stale URLs don't confuse newly-launched
 * agent CLIs. CLI removes run in parallel; OpenCode is a sync JSON edit.
 */
async function teardownDiscovery() {
  await Promise.allSettled([unregisterFromClaude(), unregisterCodex(), unregisterGemini()]);
  unregisterOpenCode();
  try {
    fs.unlinkSync(ENDPOINT_FILE);
  } catch (_) {}
}

/**
 * Promise wrapper around execFile with a default 5s timeout. Resolves with
 * stdout (utf8), rejects with the underlying execFile error.
 *
 * @param {string} binaryPath
 * @param {string[]} args
 * @param {object} [opts]
 * @returns {Promise<string>}
 */
function runCmd(binaryPath, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      args,
      { timeout: SUBPROCESS_TIMEOUT_MS, encoding: 'utf8', ...opts },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout || '');
      },
    );
  });
}

/**
 * Find a CLI binary by name. Probes well-known install locations first
 * (Node-for-Max inherits a minimal PATH), then falls back to asking the
 * user's login shell — picks up custom paths from .zshrc / asdf / mise / etc.
 *
 * @param {string} name - CLI binary name (e.g. "claude", "codex").
 * @returns {string|null} Absolute path to the binary, or null if not found.
 */
/**
 * Build the list of NVM-managed candidate paths for a binary name. Reads
 * `~/.nvm/alias/default` to prioritize the user's default Node version,
 * then enumerates every other installed version under
 * `~/.nvm/versions/node/`. Returns an empty array if NVM isn't installed
 * or the directories aren't readable.
 *
 * @param {string} name
 * @returns {string[]}
 */
function _nvmCandidates(name) {
  const nvmRoot = path.join(os.homedir(), '.nvm', 'versions', 'node');
  const aliasFile = path.join(os.homedir(), '.nvm', 'alias', 'default');
  const result = [];
  let defaultVer = null;
  try {
    const content = fs.readFileSync(aliasFile, 'utf8').trim();
    defaultVer = content.startsWith('v') ? content : `v${content}`;
    result.push(path.join(nvmRoot, defaultVer, 'bin', name));
  } catch (_) {}
  try {
    for (const dir of fs.readdirSync(nvmRoot)) {
      if (dir !== defaultVer) {
        result.push(path.join(nvmRoot, dir, 'bin', name));
      }
    }
  } catch (_) {}
  return result;
}

/**
 * Resolve the absolute path of a CLI binary (claude / codex / gemini /
 * opencode) on disk, or null if not found. Uses an explicit candidate list
 * for the well-known install locations + NVM probe + a shell fallback.
 *
 * @param {string} name - CLI binary name (e.g. "claude", "gemini").
 * @returns {string|null} Absolute path to the binary, or null if not found.
 */
function resolveBin(name) {
  // Probe well-known absolute install paths via fs.accessSync — instant and
  // immune to cold-start subprocess timeouts (running `<bin> --version` at
  // boot can exceed SUBPROCESS_TIMEOUT_MS when the OS hasn't warmed the
  // binary yet, leaving the agent silently undetected).
  //
  // Includes NVM-installed paths because the shell fallback `zsh -lc` doesn't
  // load `.zshrc` (only `.zprofile`/`.zlogin`), and NVM's PATH wiring lives
  // in `.zshrc`. So when Live is launched from launchd (no inherited PATH),
  // `command -v gemini` returns nothing even though the binary is on disk.
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', name),
    path.join(os.homedir(), '.opencode', 'bin', name),
    path.join(os.homedir(), '.bun', 'bin', name),
    path.join(os.homedir(), '.npm-global', 'bin', name),
    path.join(os.homedir(), '.cargo', 'bin', name),
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    ..._nvmCandidates(name),
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {}
  }
  // Fallback: ask the user's login shell — picks up custom paths from .zshrc
  // / asdf / mise / etc. The shell call itself is cheap (<200ms) compared to
  // spawning the target binary, so the timeout here is rarely a concern.
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const output = execFileSync(shell, ['-lc', `command -v ${name}`], {
      encoding: 'utf8',
      timeout: SUBPROCESS_TIMEOUT_MS,
    }).trim();
    if (output && output.startsWith('/')) {
      fs.accessSync(output, fs.constants.X_OK);
      return output;
    }
  } catch (_) {}
  return null;
}

/**
 * Register the device with Codex CLI's MCP config.
 *
 * @param {string} url
 * @param {string} token
 */
async function registerCodex(url, token) {
  const binaryPath = resolveBin('codex');
  if (!binaryPath) {
    log('codex not found');
    return;
  }
  uiState.agents.codex.detected = true;
  const headerArg = `Authorization: Bearer ${token}`;
  try {
    const list = await runCmd(binaryPath, ['mcp', 'list']);
    if (list.includes(SERVER_NAME)) {
      // Trust the existing entry — re-registration would need a remove first.
      uiState.agents.codex.registered = true;
      log('codex: already registered (token must match endpoint.json)');
      return;
    }
  } catch (_) {}
  try {
    await runCmd(binaryPath, ['mcp', 'add', SERVER_NAME, '--url', url, '--header', headerArg]);
    uiState.agents.codex.registered = true;
    log('codex: registered (with auth)');
  } catch (err) {
    log(
      `codex mcp add failed: ${err.message} — run manually: codex mcp add ${SERVER_NAME} --url ${url} --header "${headerArg}"`,
    );
  }
}

/**
 * Register the device with Gemini CLI's MCP config.
 *
 * @param {string} url
 * @param {string} token
 */
async function registerGemini(url, token) {
  const binaryPath = resolveBin('gemini');
  if (!binaryPath) {
    log('gemini not found');
    return;
  }
  uiState.agents.gemini.detected = true;
  const headerArg = `Authorization: Bearer ${token}`;
  try {
    const list = await runCmd(binaryPath, ['mcp', 'list']);
    if (list.includes(SERVER_NAME)) {
      uiState.agents.gemini.registered = true;
      log('gemini: already registered (token must match endpoint.json)');
      return;
    }
  } catch (_) {}
  try {
    await runCmd(binaryPath, [
      'mcp',
      'add',
      SERVER_NAME,
      url,
      '--transport',
      'http',
      '--scope',
      'user',
      '--header',
      headerArg,
    ]);
    uiState.agents.gemini.registered = true;
    log('gemini: registered (with auth)');
  } catch (err) {
    log(
      `gemini mcp add failed: ${err.message} — run manually: gemini mcp add ${SERVER_NAME} ${url} --transport http --scope user --header "${headerArg}"`,
    );
  }
}

/**
 * Register the device by JSON-merging into OpenCode's config. OpenCode's
 * `mcp add` is interactive (prompts for type/url) so we can't drive it via
 * runCmd ; same pattern we used for Claude Desktop.
 *
 * @param {string} url
 * @param {string} token
 */
function registerOpenCode(url, token) {
  const binaryPath = resolveBin('opencode');
  if (!binaryPath) {
    log('opencode not found');
    return;
  }
  uiState.agents.opencode.detected = true;

  let cfg = {};
  if (fs.existsSync(OPENCODE_CONFIG)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(OPENCODE_CONFIG, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed;
    } catch (err) {
      log(`opencode config unreadable (${err.message}) — overwriting with fresh entry`);
    }
  }
  const expectedEntry = {
    type: 'remote',
    url,
    enabled: true,
    headers: { Authorization: `Bearer ${token}` },
  };
  const existing = cfg?.mcp?.[SERVER_NAME];
  // Re-register if missing, URL changed, or token rotated.
  if (
    existing &&
    existing.url === url &&
    existing.headers?.Authorization === expectedEntry.headers.Authorization
  ) {
    uiState.agents.opencode.registered = true;
    log('opencode: already registered');
    return;
  }
  try {
    fs.mkdirSync(path.dirname(OPENCODE_CONFIG), { recursive: true });
    if (!cfg.$schema) cfg.$schema = 'https://opencode.ai/config.json';
    if (!cfg.mcp) cfg.mcp = {};
    cfg.mcp[SERVER_NAME] = expectedEntry;
    fs.writeFileSync(OPENCODE_CONFIG, JSON.stringify(cfg, null, 2));
    uiState.agents.opencode.registered = true;
    log('opencode: registered (with auth)');
  } catch (err) {
    log(`opencode config write failed: ${err.message}`);
  }
}

/**
 * Race a registration promise against AGENT_REGISTRATION_TIMEOUT_MS so a
 * hung CLI cannot leak an unsettled promise forever.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {string} agentLabel - For the log line on timeout.
 * @returns {Promise<T>}
 */
function withRegistrationTimeout(promise, agentLabel) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${agentLabel} registration timed out after ${AGENT_REGISTRATION_TIMEOUT_MS / 1000}s`,
          ),
        ),
      AGENT_REGISTRATION_TIMEOUT_MS,
    );
  });
  // clearTimeout once the race settles so the timer doesn't keep the process
  // alive after the registration succeeded (otherwise Node exits with a
  // pending handle ; visible as "worker failed to exit" in Jest).
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

/**
 * Register the device with the agents the user has explicitly consented to.
 * Reads `prefs.agents` and only acts on entries with `consented: true`.
 * OpenCode is sync ; Codex + Gemini run in parallel, each with its own
 * timeout so a slow/broken CLI doesn't block the others.
 *
 * @param {{ agents?: object }} prefs
 * @param {string} url
 * @param {string} token
 * @returns {Promise<void>}
 */
function setupConsentedClients(prefs, url, token) {
  const agents = (prefs && prefs.agents) || {};
  const claude = agents.claudeCode && agents.claudeCode.consented;
  const codex = agents.codex && agents.codex.consented;
  const gemini = agents.gemini && agents.gemini.consented;
  const opencode = agents.opencode && agents.opencode.consented;

  if (claude) {
    registerWithClaude(url, token);
    installSkill('claudeCode');
  }
  if (opencode) registerOpenCode(url, token);

  const promises = [];
  if (codex) {
    promises.push(
      withRegistrationTimeout(registerCodex(url, token), 'codex').catch((err) =>
        log(`codex registration error: ${err.message}`),
      ),
    );
  }
  if (gemini) {
    promises.push(
      withRegistrationTimeout(registerGemini(url, token), 'gemini').catch((err) =>
        log(`gemini registration error: ${err.message}`),
      ),
    );
  }
  return Promise.all(promises).then(() => undefined);
}

/**
 * Install the bundled agent4live skill for an agent that supports a native
 * skill mechanism. Currently only Claude Code (`~/.claude/skills/agent4live/
 * SKILL.md`) — the other CLIs rely on the `get_usage_guide` tool instead.
 * Best-effort : a missing/locked filesystem won't block the registration
 * itself, but it gets logged so the user can investigate.
 *
 * @param {string} agent
 */
function installSkill(agent) {
  if (agent !== 'claudeCode') return;
  try {
    fs.mkdirSync(CLAUDE_SKILL_DIR, { recursive: true });
    fs.writeFileSync(CLAUDE_SKILL_FILE, SKILL_FILE_BODY, 'utf8');
    log('Installed agent4live skill for Claude Code');
  } catch (err) {
    log(`Skill install failed for Claude Code: ${err.message}`);
  }
}

/**
 * Remove the agent4live skill installed for `agent`. Mirror of installSkill
 * — only Claude Code has a file to remove. Idempotent : missing file or
 * non-empty parent dir don't throw.
 *
 * @param {string} agent
 */
function uninstallSkill(agent) {
  if (agent !== 'claudeCode') return;
  try {
    fs.unlinkSync(CLAUDE_SKILL_FILE);
  } catch (_) {
    // file may not exist — that's fine, treat as already-uninstalled.
  }
  try {
    fs.rmdirSync(CLAUDE_SKILL_DIR);
  } catch (_) {
    // dir not empty (user added other files) or never existed — ignore.
  }
}

/**
 * Register a single agent on demand (e.g. user clicked "Register" in the UI).
 * Also installs the agent4live skill if the agent supports a native skill
 * mechanism (Claude Code only — see installSkill). Returns a Promise that
 * settles when the registration completes (or times out for codex/gemini).
 * Throws synchronously on unknown agent.
 *
 * @param {string} agent - 'claudeCode' | 'codex' | 'gemini' | 'opencode'
 * @param {string} url
 * @param {string} token
 * @returns {Promise<void>}
 */
function registerOne(agent, url, token) {
  const onSuccess = () => auditLog('register', { agent, url, tokenHash: hashToken(token) });
  switch (agent) {
    case 'claudeCode':
      registerWithClaude(url, token);
      installSkill(agent);
      onSuccess();
      return Promise.resolve();
    case 'opencode':
      registerOpenCode(url, token);
      onSuccess();
      return Promise.resolve();
    case 'codex':
      return withRegistrationTimeout(registerCodex(url, token), 'codex')
        .then(onSuccess)
        .catch((err) => log(`codex registration error: ${err.message}`));
    case 'gemini':
      return withRegistrationTimeout(registerGemini(url, token), 'gemini')
        .then(onSuccess)
        .catch((err) => log(`gemini registration error: ${err.message}`));
    default:
      throw new Error(`unknown agent: ${agent}`);
  }
}

/**
 * Unregister a single agent on demand. Also removes the installed skill
 * file (Claude Code only) so consent revoke is fully symmetric.
 *
 * @param {string} agent
 * @returns {Promise<void>}
 */
function unregisterOne(agent) {
  const onSuccess = () => auditLog('unregister', { agent });
  switch (agent) {
    case 'claudeCode':
      uninstallSkill(agent);
      return unregisterFromClaude().then(onSuccess);
    case 'codex':
      return unregisterCodex().then(onSuccess);
    case 'gemini':
      return unregisterGemini().then(onSuccess);
    case 'opencode':
      unregisterOpenCode();
      onSuccess();
      return Promise.resolve();
    default:
      throw new Error(`unknown agent: ${agent}`);
  }
}

module.exports = {
  detectAgents,
  detectClaude,
  setupDiscovery,
  regenerateToken,
  teardownDiscovery,
  setupConsentedClients,
  registerOne,
  unregisterOne,
  installSkill,
  uninstallSkill,
};
