'use strict';

// HTTP-side security utilities shared by every route handler.
//
// Today: Origin allow-list (CSRF defense). Future: rate-limiting, bearer
// rotation, etc. — anything cross-cutting that isn't tied to the MCP
// transport itself.

const { log } = require('../ui/state');

/**
 * CSRF defense — only accept requests whose Origin header points to localhost
 * (or has no Origin at all, which means a non-browser client like an agent
 * CLI). Accepting an absent Origin is a deliberate trade-off (Gap C) : agent
 * CLIs and curl don't send one, and the Bearer token guards the
 * sensitive endpoints regardless.
 *
 * @param {string|undefined} origin - Request's Origin header.
 * @returns {boolean}
 */
function isLocalOrigin(origin) {
  if (!origin) return true;
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

/**
 * Reject a request whose Origin header points elsewhere by writing a 403 and
 * logging. Returns true if the request was rejected (caller must stop), false
 * if it should continue.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {boolean} true when blocked (caller returns), false to proceed.
 */
function rejectIfNonLocalOrigin(req, res) {
  const origin = req.headers.origin;
  if (isLocalOrigin(origin)) return false;
  log('auth: rejected non-local origin ' + origin);
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'forbidden_origin' }));
  return true;
}

module.exports = { isLocalOrigin, rejectIfNonLocalOrigin };
