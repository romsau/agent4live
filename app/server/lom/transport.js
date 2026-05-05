'use strict';

// Node ↔ Max [js] transport.
// Each LOM op is a request/response cycle :
//   1. Node calls Max.outlet('lom_<op>', id, ...args)
//   2. lom_router.js (Max [js]) handles it and outlets back ('lom_response', id, status, value)
//   3. Max-API delivers the response to our handler, which resolves the matching pending promise.
//
// Pending requests are keyed by an auto-incrementing id. A 10s safety
// timeout guards against router-side bugs that drop the response.

const Max = require('max-api');
const { LOM_TIMEOUT_MS: TIMEOUT_MS } = require('../config');
const { uiState, uiRender, log } = require('../ui/state');

const pending = new Map();
let nextId = 0;

Max.addHandler('lom_response', (id, status, value) => {
  log(`lom_response id=${id} status=${status}`);
  const entry = pending.get(Number(id));
  if (!entry) {
    log(`lom_response: no pending cb for id=${id}`);
    return;
  }
  clearTimeout(entry.timer);
  pending.delete(Number(id));
  if (status === 'ok') entry.resolve(value);
  else entry.reject(new Error(String(value)));
});

/**
 * Register a pending request, with a timeout that rejects the promise
 * if no response arrives within TIMEOUT_MS.
 *
 * @param {number} id
 * @param {(value: unknown) => void} resolve
 * @param {(err: Error) => void} reject
 */
function registerPending(id, resolve, reject) {
  // Timer is cleared on response (either status) and on outlet rejection,
  // so by the time it fires the entry is guaranteed still present.
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`LOM timeout after ${TIMEOUT_MS / 1000}s`));
  }, TIMEOUT_MS);
  pending.set(id, { resolve, reject, timer });
}

/**
 * Send one outlet message and resolve when its matching `lom_response`
 * arrives. Updates the UI's liveApiOk + latency on every roundtrip.
 *
 * @param {string} opName - The outlet name (e.g. "lom_request" or "lom_add_clip").
 * @param {...unknown} payloadArgs - Positional args after the auto-generated id.
 * @returns {Promise<unknown>}
 */
function sendOutlet(opName, ...payloadArgs) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const startMs = Date.now();
    const wrappedResolve = (value) => {
      uiState.liveApiOk = true;
      uiState.latencyMs = Date.now() - startMs;
      uiRender();
      resolve(value);
    };
    const wrappedReject = (err) => {
      uiState.liveApiOk = false;
      uiRender();
      reject(err);
    };
    registerPending(id, wrappedResolve, wrappedReject);
    log(`outlet: ${opName} ${id} ${payloadArgs.join(' ')}`);
    Max.outlet(opName, id, ...payloadArgs)
      .then(() => log(`outlet sent ok: id=${id}`))
      .catch((err) => {
        log(`outlet error: ${err.message}`);
        const entry = pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(id);
          wrappedReject(new Error(`Max.outlet failed: ${err.message}`));
        }
      });
  });
}

/**
 * Generic LOM op — handled by lom_request() in lom_router.js. Used for
 * `get` / `set` / `call` against an arbitrary LOM path.
 *
 * @param {'get' | 'set' | 'call'} op
 * @param {string} lomPath - Space-separated LOM path (e.g. "live_set tracks 0").
 * @param {string} prop - Property name or method name.
 * @param {...unknown} values - For `set`: the value. For `call`: method args. For `get`: ignored.
 * @returns {Promise<unknown>}
 */
function lomOp(op, lomPath, prop, ...values) {
  const pathParts = lomPath.split(' ');
  if (!lomPath || pathParts[0] === '') {
    return Promise.reject(new Error('lomOp: lomPath cannot be empty'));
  }
  // Skip undefined values — callers can pass them as positional gaps for optional args.
  const trimmedValues = values.filter((value) => value !== undefined);
  return sendOutlet('lom_request', op, pathParts.length, ...pathParts, prop, ...trimmedValues);
}

/**
 * Named outlet for dedicated handlers — lom_router.js exposes one function
 * per opName (e.g. `lom_add_clip`, `lom_get_clip_notes`).
 *
 * @param {string} opName
 * @param {...unknown} args
 * @returns {Promise<unknown>}
 */
function lomCustomCall(opName, ...args) {
  return sendOutlet(opName, ...args);
}

module.exports = { lomOp, lomCustomCall };
