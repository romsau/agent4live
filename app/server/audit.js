'use strict';

// Append-only forensic audit log for everything the device writes into the
// user's environment outside of its own state directory (CLI configs,
// User Library files, skill directories...). Gap E from the security
// roadmap : lets the user grep ~/.agent4live-ableton-mcp/audit.log to see
// every register / unregister / token rotation / install we performed, and
// compare timestamps against the mtime of the corresponding files — drift
// = something else touched the config after we did.
//
// Token values are never written in clear : we log the first 8 hex chars of
// SHA-256(token) so the user can correlate sessions ("the token used today
// has hash abc12345") without leaking the secret to log readers.
//
// Best-effort : a failure to append (full disk, perms) NEVER blocks the
// calling operation — the consent / rotation succeeds even if the audit
// line couldn't land.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const AUDIT_DIR = path.join(os.homedir(), '.agent4live-ableton-mcp');
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.log');

/**
 * Short, irreversible identifier for a Bearer token — first 8 hex chars of
 * SHA-256(token). Lets the user correlate audit lines without exposing the
 * actual secret. Returns "none" when called with a falsy token (the first
 * write before the device has a token, or unregister flows).
 *
 * @param {string|null|undefined} token
 * @returns {string}
 */
function hashToken(token) {
  if (!token) return 'none';
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 8);
}

/**
 * Append a single line to the audit log. Format :
 *   <ISO timestamp> <action> [k=v ...]
 * Each k=v pair is whitespace-delimited ; values are not quoted because the
 * known callers pass URLs and hex hashes only (no spaces / quotes). New
 * actions adding spaces or shell-meta chars should serialize their value
 * first.
 *
 * @param {string} action - Short identifier ("register", "unregister", ...).
 * @param {object} [details] - Key-value pairs to append after the action.
 */
function auditLog(action, details = {}) {
  const ts = new Date().toISOString();
  const parts = [ts, action];
  for (const [k, v] of Object.entries(details)) {
    parts.push(`${k}=${v}`);
  }
  const line = parts.join(' ') + '\n';
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, line, { mode: 0o600 });
    // appendFileSync's `mode` is honored only when the file is freshly
    // created. Force restrictive perms even if the file pre-existed with 644.
    try {
      fs.chmodSync(AUDIT_FILE, 0o600);
    } catch (_) {}
  } catch (_) {
    // Best-effort. We do NOT call log() here to avoid a require cycle
    // (ui/state → discovery → audit → ui/state) ; if audit is broken the
    // consent operation still succeeds.
  }
}

module.exports = { hashToken, auditLog, AUDIT_FILE, AUDIT_DIR };
