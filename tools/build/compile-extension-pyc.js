#!/usr/bin/env node
'use strict';

// Pre-build step: compile app/python_scripts/__init__.py to .pyc with
// Python 3.11 (the version Live 12 embeds). The .pyc is then embedded into
// the Node bundle by esbuild's `binary` loader so the user device can deploy
// it to the User Library Remote Scripts folder (see app/server/platform.js
// for the per-OS location) without ever asking the user to install
// python3.11.
//
// This script is a *dev-side* requirement (we need a python3.11 to produce
// the .pyc). End users don't need anything Python-related — they just drop
// the .amxd and click the in-device "Install" button.
//
// Run as part of `npm run build`. Fails loud if no python3.11 is reachable.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pythonCandidates, pythonInstallHint } = require('../../app/server/platform');

const PY_SRC = path.resolve(__dirname, '..', '..', 'app', 'python_scripts', '__init__.py');
const PYC_OUT = path.resolve(__dirname, '..', '..', 'app', 'python_scripts', '__init__.pyc');

const PYTHON_VERSION = '3.11';
const VERSION_TUPLE = `(${PYTHON_VERSION.split('.').join(', ')})`;

/**
 * Probe for a CPython 3.11 interpreter. Returns it as a spawnable pair rather
 * than a bare path so that Windows can go through the `py -3.11` launcher,
 * which selects a version by argument — on Windows every install is named
 * plain `python.exe`, so there is no versioned filename to probe for. Throws
 * with a clear, platform-appropriate message when none is found: the build
 * can't proceed without one.
 *
 * @returns {{ file: string, prefixArgs: string[] }} A runnable interpreter.
 */
function findPython311() {
  for (const candidate of pythonCandidates(PYTHON_VERSION)) {
    try {
      const out = execFileSync(
        candidate.file,
        [...candidate.prefixArgs, '-c', 'import sys; print(sys.version_info[:2])'],
        { encoding: 'utf8', timeout: 3000 },
      );
      if (out.includes(VERSION_TUPLE)) return candidate;
    } catch (_) {}
  }
  throw new Error(
    `python${PYTHON_VERSION} not found in any known location.\n` +
      `  Install it (e.g. \`${pythonInstallHint(PYTHON_VERSION)}\`) and retry.\n` +
      '  This is a *dev-side* requirement — end users never need Python.',
  );
}

/**
 * Compile the extension source into a .pyc next to it. Idempotent — overwrites
 * the existing .pyc each call.
 */
function compile() {
  if (!fs.existsSync(PY_SRC)) {
    throw new Error(`source not found: ${PY_SRC}`);
  }
  const py = findPython311();
  execFileSync(
    py.file,
    [
      ...py.prefixArgs,
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
