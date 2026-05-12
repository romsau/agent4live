'use strict';

// Companion lifecycle helpers — detect whether the Python Remote Script is
// installed in Ableton's User Library and whether the TCP ping channel
// answers. Drives the cascade modals A (install) and B (configure
// Preferences) in the device UI.
//
// Phase A: script presence  →  fs.existsSync(__init__.py) under
//   ~/Music/Ableton/User Library/Remote Scripts/agent4live/
// Phase B: ping ok          →  app/server/python.js#isAlive()
//
// The .pyc is pre-compiled at build time (tools/build/compile-companion-pyc.js)
// with python3.11 — Live 12's bundled interpreter — and embedded in the Node
// bundle by esbuild's binary loader. End users never need python on their
// machine ; the device just writes the bytes verbatim at install time.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { isAlive } = require('./python');
const { auditLog } = require('./audit');

const REMOTE_SCRIPTS_DIR = path.join(
  os.homedir(),
  'Music',
  'Ableton',
  'User Library',
  'Remote Scripts',
);
const SCRIPT_DIR = path.join(REMOTE_SCRIPTS_DIR, 'agent4live');
const SCRIPT_PY = path.join(SCRIPT_DIR, '__init__.py');
const SCRIPT_PYC = path.join(SCRIPT_DIR, '__init__.pyc');

/**
 * Snapshot of the companion's installation + connectivity. Used by the device
 * UI to decide whether to show modal A (install) or modal B (configure).
 *
 * @returns {Promise<{ scriptInstalled: boolean, pingOk: boolean }>}
 */
async function getCompanionStatus() {
  const scriptInstalled = fs.existsSync(SCRIPT_PY);
  const pingOk = scriptInstalled ? await isAlive() : false;
  return { scriptInstalled, pingOk };
}

/**
 * Write the companion's `.py` (traceability) + `.pyc` (the file Live 12
 * actually loads) to the User Library Remote Scripts folder.
 *
 * @param {string} pySource - The Python source to install (text content).
 * @param {Uint8Array|Buffer} pycBytes - The pre-compiled bytecode.
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function installCompanion(pySource, pycBytes) {
  if (!fs.existsSync(REMOTE_SCRIPTS_DIR)) {
    try {
      fs.mkdirSync(REMOTE_SCRIPTS_DIR, { recursive: true });
    } catch (err) {
      return { ok: false, error: `cannot create User Library Remote Scripts: ${err.message}` };
    }
  }

  try {
    fs.mkdirSync(SCRIPT_DIR, { recursive: true });
    fs.writeFileSync(SCRIPT_PY, pySource, 'utf8');
    fs.writeFileSync(SCRIPT_PYC, Buffer.from(pycBytes));
  } catch (err) {
    return { ok: false, error: `failed to write companion files: ${err.message}` };
  }

  auditLog('companion-install', { path: SCRIPT_DIR });
  return { ok: true };
}

module.exports = {
  REMOTE_SCRIPTS_DIR,
  SCRIPT_DIR,
  SCRIPT_PY,
  SCRIPT_PYC,
  getCompanionStatus,
  installCompanion,
};
