'use strict';

// Extension lifecycle helpers — detect whether the Python Remote Script is
// installed in Ableton's User Library and whether the TCP ping channel
// answers. Drives the cascade modals A (install) and B (configure
// Preferences) in the device UI.
//
// Phase A: script presence  →  fs.existsSync(__init__.py) under
//   <userLibrary>/Remote Scripts/agent4live/
// Phase B: ping ok          →  app/server/bridge.js#isAlive()
//
// The .pyc is pre-compiled at build time (tools/build/compile-extension-pyc.js)
// with python3.11 — Live 12's bundled interpreter — and embedded in the Node
// bundle by esbuild's binary loader. End users never need python on their
// machine ; the device just writes the bytes verbatim at install time.
//
// User Library path is discovered from Live's own Library.cfg rather than
// hardcoded — a user who relocated their User Library to an external drive
// (common on Macs with small internal SSDs) would otherwise have us write
// to ~/Music/Ableton/User Library/... while Live scans Remote Scripts
// somewhere else entirely. The cfg parser falls back to the macOS default
// when no Live preferences are readable.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { isAlive } = require('./bridge');
const { auditLog } = require('../security/audit');

const ABLETON_PREFS_DIR = path.join(os.homedir(), 'Library', 'Preferences', 'Ableton');
const DEFAULT_REMOTE_SCRIPTS_DIR = path.join(
  os.homedir(),
  'Music',
  'Ableton',
  'User Library',
  'Remote Scripts',
);

/**
 * Parse a Library.cfg XML file to extract Live's User Library config. The cfg
 * stores it as `<ProjectPath Value="..."/>` inside `<UserLibrary>` (the
 * folder the user explicitly picked in Live > Settings > Library) and a
 * `<ProjectName Value="..."/>` sub-folder appended underneath (typically
 * "User Library"). Regex parse — no XML dependency added to keep the .amxd
 * freeze zero-deps.
 *
 * @param {string} cfgPath - Absolute path to a Library.cfg file.
 * @returns {{ projectPath: string, projectName: string }|null} The parsed
 *   pair, or null if the cfg is unreadable / missing the section / has a
 *   non-absolute ProjectPath.
 */
function _parseUserLibraryFromCfg(cfgPath) {
  let content;
  try {
    content = fs.readFileSync(cfgPath, 'utf8');
  } catch (_) {
    return null;
  }
  const m = content.match(/<UserLibrary>[\s\S]*?<ProjectPath\s+Value="([^"]+)"/);
  if (!m) return null;
  const projectPath = m[1];
  if (!projectPath.startsWith('/')) return null;
  const nameMatch = content.match(/<UserLibrary>[\s\S]*?<ProjectName\s+Value="([^"]+)"/);
  const projectName = nameMatch ? nameMatch[1] : 'User Library';
  return { projectPath, projectName };
}

/**
 * Resolve the Remote Scripts directory by reading Live's actual User Library
 * config. Scans `~/Library/Preferences/Ableton/Live X.Y/Library.cfg`, picks
 * the most recently modified one (most recently launched Live), and returns
 * `<ProjectPath>/<ProjectName>/Remote Scripts`. Falls back to the macOS
 * default when no cfg yields a ProjectPath reachable on disk (e.g. external
 * volume not mounted, no Live ever launched on this machine).
 *
 * We check `ProjectPath` (the folder the user explicitly picked) rather
 * than its `User Library` sub-folder so that a freshly relocated User
 * Library — where Live hasn't yet materialised the sub-folder — still
 * resolves correctly. installExtension() handles the actual sub-folder
 * creation via `mkdirSync({ recursive: true })`.
 *
 * @returns {string} Absolute path to the Remote Scripts directory.
 */
function resolveRemoteScriptsDir() {
  let entries;
  try {
    entries = fs.readdirSync(ABLETON_PREFS_DIR);
  } catch (_) {
    return DEFAULT_REMOTE_SCRIPTS_DIR;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.startsWith('Live ')) continue;
    const cfgPath = path.join(ABLETON_PREFS_DIR, entry, 'Library.cfg');
    try {
      const stat = fs.statSync(cfgPath);
      candidates.push({ cfgPath, mtimeMs: stat.mtimeMs });
    } catch (_) {
      // No Library.cfg in this Live version's prefs (Live never finished
      // its first boot, or the file was deleted). Skip silently.
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const { cfgPath } of candidates) {
    const parsed = _parseUserLibraryFromCfg(cfgPath);
    if (parsed && fs.existsSync(parsed.projectPath)) {
      return path.join(parsed.projectPath, parsed.projectName, 'Remote Scripts');
    }
  }

  return DEFAULT_REMOTE_SCRIPTS_DIR;
}

/**
 * Compute the on-disk paths to the agent4live extension files based on the
 * currently resolved Remote Scripts directory. Re-evaluated on each call so
 * that a Live preferences change between drops is picked up.
 *
 * @returns {{ scriptDir: string, scriptPy: string, scriptPyc: string, remoteScriptsDir: string }}
 */
function _resolvePaths() {
  const remoteScriptsDir = resolveRemoteScriptsDir();
  const scriptDir = path.join(remoteScriptsDir, 'agent4live');
  return {
    remoteScriptsDir,
    scriptDir,
    scriptPy: path.join(scriptDir, '__init__.py'),
    scriptPyc: path.join(scriptDir, '__init__.pyc'),
  };
}

/**
 * Snapshot of the extension's installation + connectivity. Used by the device
 * UI to decide whether to show modal A (install) or modal B (configure).
 *
 * @returns {Promise<{ scriptInstalled: boolean, pingOk: boolean }>}
 */
async function getExtensionStatus() {
  const { scriptPy } = _resolvePaths();
  const scriptInstalled = fs.existsSync(scriptPy);
  const pingOk = scriptInstalled ? await isAlive() : false;
  return { scriptInstalled, pingOk };
}

/**
 * Write the extension's `.py` (traceability) + `.pyc` (the file Live 12
 * actually loads) to the User Library Remote Scripts folder.
 *
 * @param {string} pySource - The Python source to install (text content).
 * @param {Uint8Array|Buffer} pycBytes - The pre-compiled bytecode.
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function installExtension(pySource, pycBytes) {
  const { remoteScriptsDir, scriptDir, scriptPy, scriptPyc } = _resolvePaths();

  if (!fs.existsSync(remoteScriptsDir)) {
    try {
      fs.mkdirSync(remoteScriptsDir, { recursive: true });
    } catch (err) {
      return { ok: false, error: `cannot create User Library Remote Scripts: ${err.message}` };
    }
  }

  try {
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(scriptPy, pySource, 'utf8');
    fs.writeFileSync(scriptPyc, Buffer.from(pycBytes));
  } catch (err) {
    return { ok: false, error: `failed to write extension files: ${err.message}` };
  }

  auditLog('extension-install', { path: scriptDir });
  return { ok: true };
}

module.exports = {
  ABLETON_PREFS_DIR,
  DEFAULT_REMOTE_SCRIPTS_DIR,
  resolveRemoteScriptsDir,
  getExtensionStatus,
  installExtension,
  _parseUserLibraryFromCfg,
  _resolvePaths,
};
