'use strict';

// JSON-over-TCP client to the agent4live Python extension. The extension
// runs as a Live Remote Script (~/Library/Preferences/Ableton/Live X.Y/
// User Remote Scripts/agent4live/__init__.py) and listens on 127.0.0.1:54321.
//
// Used for APIs that aren't reachable from Max [js] (Browser API, Tuning
// systems, etc). Each call opens a fresh socket, sends one JSON line,
// reads one JSON line back, closes. Stateless — no connection pooling.
//
// Phase 1 of the POC: ping() only. Phase 2 will layer Browser API on top.

const net = require('net');

const HOST = '127.0.0.1';
const PORT = 54321;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Send one JSON message and wait for one JSON response.
 *
 * @param {object} message - Sent as a single line of UTF-8 JSON.
 * @param {number} [timeoutMs] - Per-call timeout (default 5s).
 * @returns {Promise<object>} Parsed JSON response.
 */
function pythonCall(message, timeoutMs) {
  const budget = timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let buffer = '';
    let settled = false;
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      try {
        client.destroy();
      } catch (_) {}
      fn();
    };
    const timer = setTimeout(
      () => settle(() => reject(new Error(`python extension timeout after ${budget}ms`))),
      budget,
    );

    client.setEncoding('utf8');
    client.on('data', (chunk) => {
      buffer += chunk;
      const newlineAt = buffer.indexOf('\n');
      if (newlineAt === -1) return;
      const line = buffer.slice(0, newlineAt);
      clearTimeout(timer);
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        settle(() => reject(new Error(`python extension bad JSON: ${err.message}`)));
        return;
      }
      settle(() => resolve(parsed));
    });
    client.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(err));
    });
    client.on('close', () => {
      clearTimeout(timer);
      settle(() => reject(new Error('python extension closed connection without response')));
    });

    client.connect(PORT, HOST, () => {
      client.write(JSON.stringify(message) + '\n');
    });
  });
}

/**
 * Probe the extension. Resolves with `{ ok, version }` on success, throws on
 * connection error or timeout. Cheap (~ms over loopback) — call freely.
 *
 * @returns {Promise<{ ok: boolean, version: number }>}
 */
async function ping() {
  return pythonCall({ method: 'ping' }, 1500);
}

/**
 * Lightweight `is the extension reachable?` for the UI banner. Never throws.
 *
 * @returns {Promise<boolean>}
 */
async function isAlive() {
  try {
    const r = await ping();
    return !!(r && r.ok);
  } catch (_) {
    return false;
  }
}

/**
 * List the children of a Browser path. Empty path = top-level roots
 * (sounds, drums, instruments, audio_effects, midi_effects, plugins,
 * samples, clips, user_library, current_project, packs).
 *
 * @param {string} path - Slash-separated, e.g. 'instruments/Drum Rack'.
 * @returns {Promise<{ ok: boolean, items?: Array, error?: string }>}
 */
function browserList(path) {
  return pythonCall({ method: 'browser_list', path: path || '' });
}

/**
 * Load a BrowserItem onto the currently-selected device hot-swap target.
 *
 * @param {string} path - Slash-separated browser path (e.g. '/drums/Percussion Core Kit.adg'),
 *   as returned by browserSearch in the `path` field, or built from browserList.
 *   Starts with the attr name of the root: drums, instruments, audio_effects, etc.
 * @returns {Promise<{ ok: boolean, loaded?: string, error?: string }>}
 */
function browserLoadItem(path) {
  return pythonCall({ method: 'browser_load', path }, 15000);
}

/**
 * Search the browser tree by case-insensitive substring.
 *
 * @param {string} query
 * @param {string} [root] - Restrict to a single root (e.g. 'drums').
 * @param {number} [limit] - Max results (default 50, hard cap server-side).
 * @returns {Promise<{ ok: boolean, results?: Array, truncated?: boolean, error?: string }>}
 */
function browserSearch(query, root, limit) {
  return pythonCall(
    { method: 'browser_search', query, root: root || '', limit: limit || 50 },
    15000,
  );
}

/**
 * Send a 3-byte MIDI message via the extension's Control Surface output port.
 * Resolves with `{ ok: true }` on success ; the message is silently dropped
 * by Live if the slot has Output = "None" — there's no error in that case.
 *
 * @param {number} status - Status byte (0x80–0xEF). Examples: 0x90 = note-on
 *   ch 1, 0xB0 = CC ch 1.
 * @param {number} data1 - First data byte (note number or CC number, 0–127).
 * @param {number} data2 - Second data byte (velocity or CC value, 0–127).
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function sendMidi(status, data1, data2) {
  return pythonCall({ method: 'send_midi', status, data1, data2 });
}

module.exports = {
  pythonCall,
  ping,
  isAlive,
  browserList,
  browserLoadItem,
  browserSearch,
  sendMidi,
  HOST,
  PORT,
};
