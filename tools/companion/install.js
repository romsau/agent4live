#!/usr/bin/env node
'use strict';

// Manual installer for the agent4live Python companion (POC phase 1).
//
// Copies app/python_scripts/ to the User Library Remote Scripts folder:
//   ~/Music/Ableton/User Library/Remote Scripts/agent4live/
//
// This path was introduced in Live 10.1.13 and is the recommended location
// (persists across Live versions, no per-version reinstall). The legacy
// ~/Library/Preferences/Ableton/Live X.Y/User Remote Scripts/ no longer
// works in recent Live 12 builds — empirically verified on 12.3.8.
//
// Usage:
//   node tools/companion/install.js
//   node tools/companion/install.js --uninstall

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SRC = path.resolve(__dirname, '..', '..', 'app', 'python_scripts');
const USER_LIBRARY = path.join(os.homedir(), 'Music', 'Ableton', 'User Library');
const REMOTE_SCRIPTS_DIR = path.join(USER_LIBRARY, 'Remote Scripts');
const SCRIPT_NAME = 'agent4live';
const TARGET = path.join(REMOTE_SCRIPTS_DIR, SCRIPT_NAME);

// Live 12 ships only .pyc files compiled by Python 3.11. Live's loader
// matches the runtime version's magic number — a 3.9 .pyc is silently
// ignored. We compile with the user's local 3.11 interpreter.
const PYTHON_311_CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'python3.11'),
  '/opt/homebrew/bin/python3.11',
  '/usr/local/bin/python3.11',
  'python3.11',
];

/**
 * @returns {string|null} Absolute path to a python3.11 binary, or null if none found.
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
  return null;
}

/**
 * @param {string} src
 * @param {string} dst
 */
function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function main() {
  const args = process.argv.slice(2);
  const uninstall = args.includes('--uninstall');

  if (!fs.existsSync(USER_LIBRARY)) {
    console.error(`✗ Ableton User Library not found at ${USER_LIBRARY}.`);
    console.error('  Open Live once so it materializes the User Library, then retry.');
    process.exit(1);
  }

  if (uninstall) {
    if (fs.existsSync(TARGET)) {
      fs.rmSync(TARGET, { recursive: true, force: true });
      console.log(`✓ Uninstalled from ${TARGET}`);
    } else {
      console.log(`(nothing to uninstall — ${TARGET} not found)`);
    }
    return;
  }

  fs.mkdirSync(REMOTE_SCRIPTS_DIR, { recursive: true });
  copyDirRecursive(SRC, TARGET);

  // Compile the .py to .pyc with Python 3.11 (Live 12's bundled interpreter
  // version — a mismatched magic number makes Live silently ignore the script).
  const py311 = findPython311();
  if (!py311) {
    console.error(
      '✗ Could not locate a python3.11 binary. Install one (brew install python@3.11)\n' +
        '  or compile manually:  python3.11 -m py_compile __init__.py',
    );
    process.exit(1);
  }
  try {
    execFileSync(
      py311,
      [
        '-c',
        `import py_compile; py_compile.compile('${path.join(TARGET, '__init__.py')}', cfile='${path.join(TARGET, '__init__.pyc')}', doraise=True)`,
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
  } catch (err) {
    console.error('✗ py_compile failed:', err.message);
    process.exit(1);
  }

  console.log(`✓ Installed to ${TARGET}`);
  console.log(`  (compiled .pyc with ${py311})`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. (Re)start Ableton Live');
  console.log('  2. Preferences → Link/Tempo/MIDI → Control Surface dropdown → "agent4live"');
  console.log('  3. MIDI in/out for that slot: leave at "None"');
  console.log('  4. Test the channel:  node tools/companion/ping.js');
}

/* istanbul ignore if -- CLI entry guard. */
if (require.main === module) {
  main();
}

module.exports = {
  findPython311,
  copyDirRecursive,
  main,
  REMOTE_SCRIPTS_DIR,
  TARGET,
  USER_LIBRARY,
};
