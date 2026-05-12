'use strict';

// Bootstrap: HTTP server + active/passive mode lifecycle.
//
// active mode  — owns the port, runs the MCP server, registers with agent
//                CLIs, lights up the green UI.
// passive mode — another agent4live device on this machine already owns the
//                port. We keep retrying to grab it (auto-takeover) and show a
//                "duplicate device" UI pointing at the active peer's track.

const http = require('http');
const Max = require('max-api');
const {
  PORT,
  PASSIVE_BOOT_DELAY_MS,
  PASSIVE_TICK_MS,
  ACTIVE_BOOT_DELAY_MS,
  ACTIVE_LOM_PING_DELAY_MS,
} = require('./config');
const {
  uiState,
  log,
  uiRender,
  buildUiHtml,
  buildPassiveUiHtml,
  emitLoadingUi,
} = require('./ui/state');
const {
  detectAgents,
  setupDiscovery,
  regenerateToken,
  teardownDiscovery,
  setupConsentedClients,
  registerOne,
  unregisterOne,
} = require('./discovery');
const {
  loadPreferences,
  savePreferences,
  defaultPreferences,
  markConsent,
  isFirstBoot,
  migrateFromExistingConfigs,
  applyAutoRegisterEnv,
  AGENTS,
  PREFERENCES_FILE,
} = require('./preferences');
const fs = require('fs');
const { getCompanionStatus, installCompanion } = require('./companion');
// Python companion files — bundled by esbuild so the device can deploy them
// to the User Library at install time without ever asking the user for
// python3.11. The .py is text (debug + diffability), the .pyc is the binary
// Live 12 actually loads (compiled by tools/build/compile-companion-pyc.js).
const COMPANION_PY_SOURCE = require('../python_scripts/__init__.py');
const COMPANION_PYC_BYTES = require('../python_scripts/__init__.pyc');
const { lomGet, lomScanPeers } = require('./lom');
const { handleMCP } = require('./mcp/server');
const { rejectIfNonLocalOrigin } = require('./auth');

// First thing the node script does: push a neutral Loading placeholder to the
// jweb. This overrides any stale URL the jweb might still hold (e.g. a passive
// data: view from a previous session) so the user can never see a flash of the
// wrong view before active/passive is decided. The real URL is pushed later by
// uiRender() (active) or emitPassiveUi() (passive).
emitLoadingUi();

detectAgents();
log(`Node.js ${process.version} / ${process.platform} pid=${process.pid}`);

const UI_HTML = buildUiHtml();

const httpServer = http.createServer((req, res) => {
  log(`${req.method} ${req.url}`);
  // Gap A — CSRF defense-in-depth : reject non-local Origin BEFORE routing so
  // every endpoint (including /preferences*, /companion/*, /detect, /ui*) is
  // uniformly protected. /mcp's checkAuth still runs its own Origin check ;
  // the double-check is harmless and keeps that layer self-contained.
  if (rejectIfNonLocalOrigin(req, res)) return;
  if (req.url === '/mcp') {
    handleMCP(req, res).catch((err) => {
      log(`Request error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
    return;
  }
  if (req.url === '/ui') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(UI_HTML);
    return;
  }
  if (req.url === '/ui/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    // Strip secret fields, enrich with consent state from preferences so the
    // UI can render the modal + per-card Register/Unregister buttons.
    const { token: _token, agents: rawAgents, ...rest } = uiState;
    const prefs = loadPreferences();
    const consents = (prefs && prefs.agents) || {};
    const enrichedAgents = {};
    for (const [key, info] of Object.entries(rawAgents)) {
      enrichedAgents[key] = {
        ...info,
        consented: !!(consents[key] && consents[key].consented),
      };
    }
    res.end(
      JSON.stringify({
        ...rest,
        agents: enrichedAgents,
        firstBoot: isFirstBoot(prefs),
        // companionStatus already in `rest` (from uiState) — explicit here
        // for documentation purposes ; the spread covers it.
      }),
    );
    return;
  }
  if (req.url === '/preferences' && req.method === 'GET') {
    const prefs = loadPreferences() || defaultPreferences();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(prefs));
    return;
  }
  if (req.url === '/preferences' && req.method === 'POST') {
    handlePreferencesBatch(req, res).catch((err) => prefsErrorReply(res, 400, err));
    return;
  }
  /* istanbul ignore next -- defensive `|| ''` against undefined req.url ;
     Node's HTTP server always populates req.url for incoming requests. */
  const agentRouteMatch = /^\/preferences\/agent\/([a-zA-Z]+)$/.exec(req.url || '');
  if (agentRouteMatch && req.method === 'POST') {
    handlePreferencesAgent(agentRouteMatch[1], req, res).catch((err) =>
      prefsErrorReply(res, 400, err),
    );
    return;
  }
  if (req.url === '/preferences/reset' && req.method === 'POST') {
    handlePreferencesReset(res).catch((err) => prefsErrorReply(res, 500, err));
    return;
  }
  if (req.url === '/preferences/rotate-token' && req.method === 'POST') {
    handleRotateToken(req, res).catch((err) => prefsErrorReply(res, 500, err));
    return;
  }
  if (req.url === '/companion/install' && req.method === 'POST') {
    handleCompanionInstall(res).catch((err) => companionErrorReply(res, 500, err));
    return;
  }
  if (req.url === '/companion/recheck' && req.method === 'POST') {
    handleCompanionRecheck(res).catch((err) => companionErrorReply(res, 500, err));
    return;
  }
  if (req.url === '/detect' && req.method === 'POST') {
    detectAgents();
    const tokenAfter = setupDiscovery(PORT);
    if (tokenAfter) uiState.token = tokenAfter;
    // Re-apply consent: only register agents the user has previously consented
    // to. New agents discovered after first boot must go through the modal /
    // explicit consent flow before being registered.
    setupConsentedClients(loadPreferences(), `http://127.0.0.1:${PORT}/mcp`, tokenAfter);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

/**
 * Read a JSON body from an http.IncomingMessage. Empty body → {}.
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<object>}
 */
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/**
 * Apply a single agent's consent change : register/unregister + mark in prefs.
 *
 * @param {string} agent
 * @param {boolean} consented
 * @param {object} prefs - Mutated in place.
 * @param {string} url
 * @param {string} token
 */
async function applyConsent(agent, consented, prefs, url, token) {
  if (consented) {
    markConsent(prefs, agent, true, url);
    await registerOne(agent, url, token);
  } else {
    markConsent(prefs, agent, false);
    await unregisterOne(agent);
  }
}

/**
 * POST /preferences — batch update of all agents at once. Body shape:
 * `{ claudeCode: bool, codex: bool, gemini: bool, opencode: bool }`
 * Missing keys are left untouched.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handlePreferencesBatch(req, res) {
  const body = await readJsonBody(req);
  const prefs = loadPreferences() || defaultPreferences();
  const url = `http://127.0.0.1:${PORT}/mcp`;
  const token = uiState.token;
  for (const agent of AGENTS) {
    if (typeof body[agent] !== 'boolean') continue;
    // No-op skip: avoid spawning mcp add/remove subprocesses for agents whose
    // consent state isn't changing. The Modal C mutex sends `false` for every
    // non-selected agent on every click ; without this skip, deselecting 3
    // already-unconsented agents costs 3 unnecessary subprocess round-trips.
    const before = !!(prefs.agents[agent] && prefs.agents[agent].consented);
    if (before === body[agent]) continue;
    await applyConsent(agent, body[agent], prefs, url, token);
  }
  savePreferences(prefs);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(prefs));
}

/**
 * POST /preferences/agent/:name — toggle a single agent. Body: `{ consented: bool }`.
 *
 * @param {string} agent
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handlePreferencesAgent(agent, req, res) {
  if (!AGENTS.includes(agent)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `unknown agent: ${agent}` }));
    return;
  }
  const body = await readJsonBody(req);
  if (typeof body.consented !== 'boolean') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing or invalid `consented` field' }));
    return;
  }
  const prefs = loadPreferences() || defaultPreferences();
  const url = `http://127.0.0.1:${PORT}/mcp`;
  await applyConsent(agent, body.consented, prefs, url, uiState.token);
  savePreferences(prefs);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(prefs));
}

/**
 * POST /preferences/rotate-token (Gap D) — generate a fresh Bearer token,
 * persist it to endpoint.json, propagate to every consented CLI config.
 *
 * Auth : the caller MUST present the CURRENT Bearer (`Authorization: Bearer
 * <uiState.token>`), checked explicitly here on top of the top-level Origin
 * guard. Without this defense-in-depth, any local process that can hit
 * loopback could rotate the token and lock out the legitimate user (worse :
 * a local attacker could seize the new token from the response and gain
 * /mcp access from a state where they had nothing).
 *
 * After rotation, in-flight CLI sessions still hold the OLD token in memory.
 * Their next /mcp request will get 401 — the user must restart their CLI for
 * it to re-read its config (which now has the new token).
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleRotateToken(req, res) {
  const auth = req.headers.authorization || '';
  const bearerMatch = auth.match(/^Bearer (.+)$/);
  if (!bearerMatch || !uiState.token || bearerMatch[1] !== uiState.token) {
    log('rotate-token: rejected ' + (bearerMatch ? 'invalid' : 'missing') + ' bearer');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const newToken = regenerateToken(PORT);
  if (!newToken) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'rotation_failed' }));
    return;
  }
  uiState.token = newToken;
  // Best-effort propagation to consented CLIs ; if one CLI's config write
  // fails, the others still get updated. The user can re-trigger if needed.
  await setupConsentedClients(loadPreferences(), `http://127.0.0.1:${PORT}/mcp`, newToken);
  log('rotate-token: success');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      ok: true,
      message: 'Token rotated. Restart your agent CLI to pick up the new token.',
    }),
  );
}

/**
 * POST /preferences/reset — unregister every agent + delete preferences.json.
 * Returns the device to "first boot" state ; the modal will appear again.
 *
 * @param {http.ServerResponse} res
 */
async function handlePreferencesReset(res) {
  for (const agent of AGENTS) {
    try {
      await unregisterOne(agent);
    } catch (_) {}
  }
  try {
    fs.unlinkSync(PREFERENCES_FILE);
  } catch (_) {}
  // Build the response body before writeHead so a JSON error (defensive ; never
  // expected for a fresh defaultPreferences object) bubbles up to the outer
  // catch and produces a 500 instead of a half-written 200.
  const body = JSON.stringify(defaultPreferences());
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
}

/**
 * Refresh `uiState.companionStatus` from the live filesystem + ping. Called
 * at boot and after every install/recheck so the polled /ui/state stays
 * fresh without making a TCP ping every 500ms.
 *
 * @returns {Promise<{ scriptInstalled: boolean, pingOk: boolean }>}
 */
async function updateCompanionStatus() {
  const status = await getCompanionStatus();
  uiState.companionStatus = status;
  return status;
}

/**
 * POST /companion/install — write the bundled .py to User Library + compile.
 *
 * @param {http.ServerResponse} res
 */
async function handleCompanionInstall(res) {
  const result = await installCompanion(COMPANION_PY_SOURCE, COMPANION_PYC_BYTES);
  // Refresh status either way so the UI reflects the new state.
  const status = await updateCompanionStatus();
  res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ...result, status }));
}

/**
 * POST /companion/recheck — re-probe script + ping, update state, return it.
 *
 * @param {http.ServerResponse} res
 */
async function handleCompanionRecheck(res) {
  const status = await updateCompanionStatus();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, status }));
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {Error} err
 */
function companionErrorReply(res, status, err) {
  log(`/companion error: ${err.message}`);
  /* istanbul ignore else -- defensive: handlers writeHead only on the success
     path, so headers should never be sent by the time we land here. */
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {Error} err
 */
function prefsErrorReply(res, status, err) {
  log(`/preferences error: ${err.message}`);
  /* istanbul ignore else -- defensive: by the time prefsErrorReply runs in
     the catch chain, headers should not yet be sent (handlers writeHead only
     on the success path). Skipped if a future handler reorders writes. */
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

let passiveTicker = null;
let lastEmittedTrack; // undefined sentinel = never emitted

/**
 * Push the passive-mode UI to Max as a base64 data URL. Inlined because the
 * passive UI doesn't have its own HTTP server (the active peer owns the port).
 *
 * @param {string|null} trackName
 */
function emitPassiveUi(trackName) {
  const html = buildPassiveUiHtml(trackName);
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html, 'utf8').toString('base64');
  Max.outlet('ui_status', 'url', dataUrl).catch(() => {});
}

/**
 * Single passive-mode iteration: try to take over the port, scan the LOM
 * for peer agent4live devices, and refresh the UI if the active peer's
 * track name changed.
 */
async function passiveTick() {
  // (1) Retry bind — auto-takeover if the active died.
  // listen() is no-op if server is already listening; safe to call repeatedly
  // after a previous EADDRINUSE error.
  try {
    httpServer.listen(PORT, '127.0.0.1');
  } catch (_) {}

  // (2) Scan LOM + refresh data URL if the active's track changed.
  try {
    const json = await lomScanPeers();
    const data = JSON.parse(json);
    const peer = (data.peers || []).find((candidate) => !candidate.isSelf);
    const trackName = peer ? peer.trackName : null;
    if (trackName !== lastEmittedTrack) {
      lastEmittedTrack = trackName;
      uiState.activePeer = trackName ? { trackName } : null;
      emitPassiveUi(trackName);
    }
  } catch (err) {
    log(`Passive scan failed: ${err.message}`);
  }
}

/** Switch from `active` to `passive` mode (port is busy on this machine). */
function enterPassiveMode() {
  /* istanbul ignore if -- defensive: error handler already guards on
     uiState.mode === 'active', so this branch is unreachable in normal flow. */
  if (uiState.mode === 'passive') return;
  uiState.mode = 'passive';
  log('Port busy → entering passive mode');
  setTimeout(passiveTick, PASSIVE_BOOT_DELAY_MS);
  passiveTicker = setInterval(passiveTick, PASSIVE_TICK_MS);
}

/**
 * On true first boot (no preferences.json), inspect existing CLI configs for
 * pre-registered entries and adopt them as `consented: true` silently —
 * upgraders don't lose access. AGENT4LIVE_AUTO_REGISTER overrides CI/headless
 * the same way. Returns the prefs the caller should use.
 *
 * @param {string} url
 * @returns {{ version: number, agents: object }|null}
 */
function bootstrapPreferences(url) {
  const existing = loadPreferences();
  if (existing) return existing;

  const fresh = defaultPreferences();
  const migrated = migrateFromExistingConfigs();
  for (const [agent, ok] of Object.entries(migrated)) {
    if (ok) markConsent(fresh, agent, true, url);
  }
  applyAutoRegisterEnv(fresh, url);

  if (Object.keys(fresh.agents).length > 0) {
    savePreferences(fresh);
    log(`Preferences bootstrapped (agents: ${Object.keys(fresh.agents).join(', ')})`);
    return fresh;
  }
  // Nothing migrated, no env override — let the modal handle consent.
  return null;
}

/**
 * Wire up everything an active device does at boot: write endpoint.json,
 * light up the green UI, re-apply previously-consented CLI registrations,
 * and ping the LOM to confirm the bridge is alive. New consents go through
 * the modal exposed by /ui — no auto-registration of new agents at boot.
 */
function activeBoot() {
  log(`Server ready → http://127.0.0.1:${PORT}/mcp`);
  const url = `http://127.0.0.1:${PORT}/mcp`;
  const token = setupDiscovery(PORT);
  if (token) uiState.token = token;
  uiState.connected = true;
  uiState.port = PORT;
  uiRender();
  const prefs = bootstrapPreferences(url);
  setTimeout(() => setupConsentedClients(prefs, url, token), ACTIVE_BOOT_DELAY_MS);
  setTimeout(() => {
    lomGet('live_set', 'tempo').catch((err) => log(`Initial LOM ping failed: ${err.message}`));
  }, ACTIVE_LOM_PING_DELAY_MS);
  // Companion check is async + best-effort — drives modals A/B in the UI.
  updateCompanionStatus().catch((err) => log(`Companion check failed: ${err.message}`));
}

/** Switch from `passive` to `active` mode (we just acquired the port). */
function becomeActive() {
  /* istanbul ignore else -- defensive: becomeActive is only invoked after
     enterPassiveMode set up the ticker, so the else branch is unreachable. */
  if (passiveTicker) {
    clearInterval(passiveTicker);
    passiveTicker = null;
  }
  uiState.mode = 'active';
  uiState.activePeer = null;
  lastEmittedTrack = undefined;
  log('Acquired port — switching from passive to active');
  activeBoot();
}

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    if (uiState.mode === 'active' && !uiState.connected) {
      enterPassiveMode();
    }
    // else: passive retry-bind that failed — expected, stay quiet
  } else {
    log(`Server error: ${err.message}`);
  }
});

/** Graceful shutdown — clear the ticker, drop the discovery file, close HTTP. */
async function shutdown() {
  if (passiveTicker) clearInterval(passiveTicker);
  if (uiState.mode === 'active') await teardownDiscovery();
  uiState.connected = false;
  uiRender();
  httpServer.close(() => log('Server closed'));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

httpServer.listen(PORT, '127.0.0.1', () => {
  if (uiState.mode === 'passive') becomeActive();
  else activeBoot();
});
