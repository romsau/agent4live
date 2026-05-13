#!/usr/bin/env node
'use strict';

// Probe the agent4live Python extension. Prints OK + protocol version on
// success, the error otherwise. Useful to sanity-check the channel before
// touching the runtime device.
//
// Usage:  node tools/extension/ping.js

const path = require('path');
const { ping } = require(
  path.resolve(__dirname, '..', '..', 'app', 'server', 'extension', 'bridge.js'),
);

/**
 * Wrap `ping()` for CLI use: pretty-print + exit code. Exposed so the test
 * suite can drive it without spawning a subprocess.
 *
 * @param {object} [io] - { log, error, exit } overrides — defaults to console + process.exit
 * @returns {Promise<void>}
 */
async function runPing(io) {
  const log = (io && io.log) || console.log;
  const error = (io && io.error) || console.error;
  const exit = (io && io.exit) || process.exit;
  try {
    const r = await ping();
    log('✓ extension alive:', JSON.stringify(r));
    exit(0);
  } catch (err) {
    error('✗', err.message);
    error('  Is Live running with "agent4live" assigned in Preferences → Control Surface?');
    exit(1);
  }
}

/* istanbul ignore if -- CLI entry guard. */
if (require.main === module) {
  runPing();
}

module.exports = { runPing };
