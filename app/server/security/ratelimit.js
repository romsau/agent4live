'use strict';

// Token-bucket rate limiter — Gap B from the security roadmap.
//
// 3 catégories de buckets, calibrées pour ne JAMAIS bloquer un usage légitime
// tout en stoppant net un agent qui boucle ou une page web qui spamme :
//   - `mcp`    : 60 req/s sustained, 120 burst — agent traffic + fan-out
//   - `ui`     : 10 req/s sustained,  30 burst — jweb poll /ui/state (2 req/s
//                en steady-state, 5× headroom)
//   - `config` :  2 req/s sustained,  10 burst — mutation config par humain
//                (Modal C, install extension). Humain n'atteint jamais ça.
//
// Sur dépassement : 429 + header `Retry-After: <s>` + body JSON
// `{ error: 'rate_limited', category, retryAfter }` pour qu'un agent
// bien-codé back-off intelligemment au lieu de hammerer.
//
// Routes inconnues (404 candidates) : pas de bucket → laissées passer pour
// que le routing normal réponde 404. Pas de penalty sur 404 spam.
//
// Algo : token bucket lazy-refill. À chaque `take()` on calcule combien de
// tokens ont régénéré depuis le `lastRefill` et on cap au burst. Pas de
// timer, pas de setInterval — math pure côté serveur. Reset au reboot du
// device (state in-memory, voulu).
//
// Tests : env vars `AGENT4LIVE_RATELIMIT_<CAT>_BURST` et `_REFILL` override
// les constantes pour les scénarios E2E qui veulent stresser sans attendre.

const { log } = require('../ui/state');

/**
 * Read an integer env var with a fallback default. Returns the default if
 * the env var is missing, empty, or doesn't parse to a positive int.
 *
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const BUCKETS = {
  mcp: {
    capacity: envInt('AGENT4LIVE_RATELIMIT_MCP_BURST', 120),
    refillRate: envInt('AGENT4LIVE_RATELIMIT_MCP_REFILL', 60),
  },
  ui: {
    capacity: envInt('AGENT4LIVE_RATELIMIT_UI_BURST', 30),
    refillRate: envInt('AGENT4LIVE_RATELIMIT_UI_REFILL', 10),
  },
  config: {
    capacity: envInt('AGENT4LIVE_RATELIMIT_CONFIG_BURST', 10),
    refillRate: envInt('AGENT4LIVE_RATELIMIT_CONFIG_REFILL', 2),
  },
};

// In-memory state — initialized lazily on first call so tests can reset.
// Each entry tracks how many tokens remain + when we last topped up.
let state = null;

/**
 *
 */
function init() {
  state = {};
  for (const cat of Object.keys(BUCKETS)) {
    state[cat] = { tokens: BUCKETS[cat].capacity, lastRefill: Date.now() };
  }
}

/**
 * Map a request URL to its bucket category. Returns null for unknown routes
 * (caller should let them fall through to 404 / other handlers, no throttle).
 *
 * @param {string|undefined} url
 * @returns {'mcp'|'ui'|'config'|null}
 */
function categorize(url) {
  if (!url) return null;
  if (url === '/mcp' || url.startsWith('/mcp?')) return 'mcp';
  if (url === '/ui' || url.startsWith('/ui/') || url.startsWith('/ui?')) return 'ui';
  if (url === '/detect' || url.startsWith('/preferences') || url.startsWith('/extension/')) {
    return 'config';
  }
  return null;
}

/**
 * Consume one token from the named bucket, refilling lazily based on
 * elapsed time since the last call. Returns `{ ok: true }` when the request
 * may proceed ; `{ ok: false, retryAfter: <seconds> }` otherwise.
 *
 * @param {'mcp'|'ui'|'config'} category
 * @param {number} [now] - Override Date.now() for deterministic tests.
 * @returns {{ok: true} | {ok: false, retryAfter: number}}
 */
function take(category, now = Date.now()) {
  if (!state) init();
  const bucket = state[category];
  const cfg = BUCKETS[category];
  // Math.max guards against backwards-clock jumps (NTP correction etc.).
  const elapsed = Math.max(0, (now - bucket.lastRefill) / 1000);
  bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsed * cfg.refillRate);
  bucket.lastRefill = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }
  // How many seconds until 1 token regenerates ?
  const retryAfter = Math.max(1, Math.ceil((1 - bucket.tokens) / cfg.refillRate));
  return { ok: false, retryAfter };
}

/**
 * Top-level rate-limit guard called from index.js. Returns true if the
 * request was rejected (caller must return), false if it should continue.
 *
 * `opts.bypassMcpUntil` (optional, Phase 2) lets a power-user temporarily
 * skip the /mcp bucket for legitimate massive scans. For Phase 1 (this
 * commit) the option is honored but not exposed via any endpoint yet.
 *
 * `opts.now` (optional, tests only) freezes the clock so a tight loop of
 * `rejectIfRateLimited` calls doesn't get partial refill from elapsed
 * wall-clock time. Production never passes this.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{bypassMcpUntil?: number, now?: number}} [opts]
 * @returns {boolean} true when blocked (caller returns), false to proceed.
 */
function rejectIfRateLimited(req, res, opts = {}) {
  const category = categorize(req.url);
  if (!category) return false; // unknown route → let routing answer 404
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  // Bypass : timestamp from uiState. Stale timestamps (past now) are treated
  // as no-bypass naturally.
  if (category === 'mcp' && typeof opts.bypassMcpUntil === 'number' && now < opts.bypassMcpUntil) {
    return false;
  }
  const result = take(category, now);
  if (result.ok) return false;
  log(
    `ratelimit: rejected ${req.method} ${req.url} (cat=${category}, retry=${result.retryAfter}s)`,
  );
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': String(result.retryAfter),
  });
  res.end(JSON.stringify({ error: 'rate_limited', category, retryAfter: result.retryAfter }));
  return true;
}

/**
 * Test helper — reset the bucket state so each test starts at full capacity.
 * Production code never calls this.
 */
function _resetForTests() {
  state = null;
}

module.exports = { BUCKETS, categorize, take, rejectIfRateLimited, _resetForTests };
