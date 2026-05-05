#!/usr/bin/env node
'use strict';

// Pre-build step: compile app/python_scripts/__init__.py to .pyc with
// Python 3.11 (the version Live 12 embeds). The .pyc is then embedded into
// the Node bundle by esbuild's `binary` loader so the user device can deploy
// it to ~/Music/Ableton/User Library/Remote Scripts/agent4live/ without ever
// asking the user to install python3.11.
//
// This script is a *dev-side* requirement (we need a python3.11 to produce
// the .pyc). End users don't need anything Python-related — they just drop
// the .amxd and click the in-device "Install" button.
//
// Run as part of `npm run build`. Fails loud if no python3.11 is reachable.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PY_SRC = path.resolve(__dirname, '..', '..', 'app', 'python_scripts', '__init__.py');
const PYC_OUT = path.resolve(__dirname, '..', '..', 'app', 'python_scripts', '__init__.pyc');

const PYTHON_311_CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'python3.11'),
  '/opt/homebrew/bin/python3.11',
  '/usr/local/bin/python3.11',
  'python3.11',
];

/**
 * Probe candidate paths for a python3.11 binary. Throws with a clear message
 * if none are found — the build can't proceed without one.
 *
 * @returns {string} Absolute path to a python3.11 interpreter.
 */
function findPython311() {
  for (const candidate of PYTHON_311_CANDIDATES) {
    try {
      const out = execFileSync(candidate, ['-c', 'import sys; print(sys.version_info[:2])'], {
        encoding: 'utf8',
        timeout: 3000,
      });
      if (out.includes('(3, 11)')) return candidate;
    } catch (_) {}
  }
  throw new Error(
    'python3.11 not found in any known location.\n' +
      '  Install it (e.g. `brew install python@3.11`) and retry.\n' +
      '  This is a *dev-side* requirement — end users never need Python.',
  );
}

/**
 * Compile the companion source into a .pyc next to it. Idempotent — overwrites
 * the existing .pyc each call.
 */
function compile() {
  if (!fs.existsSync(PY_SRC)) {
    throw new Error(`source not found: ${PY_SRC}`);
  }
  const py = findPython311();
  execFileSync(
    py,
    [
      '-c',
      `import py_compile; py_compile.compile(${JSON.stringify(PY_SRC)}, cfile=${JSON.stringify(PYC_OUT)}, doraise=True)`,
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
}

/* istanbul ignore if -- CLI entry guard. */
if (require.main === module) {
  try {
    compile();
    console.log(`✓ ${path.basename(PYC_OUT)} compiled with Python 3.11`);
  } catch (err) {
    console.error('✗', err.message);
    process.exit(1);
  }
}

module.exports = { compile, findPython311, PY_SRC, PYC_OUT };
