'use strict';

// Single source of truth for everything that differs between the operating
// systems Ableton Live ships on. Live runs on macOS and Windows, and the two
// disagree about every location the device needs to touch:
//
//   Live's preferences    macOS  ~/Library/Preferences/Ableton
//                         win32  %APPDATA%\Ableton
//   Default User Library  macOS  ~/Music/Ableton/User Library
//                         win32  ~\Documents\Ableton\User Library
//   Agent CLI binaries    macOS  bare names + the +x bit, /usr/local, Homebrew
//                         win32  .exe / .cmd shims, %APPDATA%\npm
//   "where is this bin"   macOS  $SHELL -lc "command -v <name>"
//                         win32  where.exe <name>
//
// Keeping those answers here rather than inline means a future contributor
// adding a third platform (Linux under Wine is the recurring ask) has exactly
// one file to edit.
//
// Everything in this module is pure string/path computation — no fs, no
// subprocess. Callers stay in charge of I/O, which keeps this trivially
// testable and keeps the mocking burden in the modules that already mock fs.
//
// The path flavour is selected explicitly (path.win32 vs path.posix) instead
// of using the ambient `path`. At runtime the two are always identical, but
// it lets the test suite pin `process.platform` and assert deterministic
// output whichever host CI happens to run on — the macOS expectations in
// install.test.js / discovery.test.js hold verbatim on a Windows checkout.

const os = require('os');
const path = require('path');

// Executable suffixes to try on Windows, in preference order. `.exe` first:
// native installers (Claude Code's own installer drops claude.exe under
// ~/.local/bin) are spawnable directly, whereas .cmd/.bat shims need to go
// through a shell — see spawnFor().
const WINDOWS_BIN_EXTENSIONS = ['.exe', '.cmd', '.bat'];

// Suffix-less on POSIX — the +x bit is what marks a file executable.
const POSIX_BIN_EXTENSIONS = [''];

/**
 * Whether the device is running on Windows. Read from `process.platform` on
 * every call rather than cached at module load, so tests can pin it.
 *
 * @returns {boolean}
 */
function isWindows() {
  return process.platform === 'win32';
}

/**
 * The `path` flavour matching the current platform. Identical to the ambient
 * `path` module at runtime; explicit here so tests that pin
 * `process.platform` get deterministic separators on any host.
 *
 * @returns {path.PlatformPath}
 */
function platformPath() {
  return isWindows() ? path.win32 : path.posix;
}

/**
 * Absolute-path test using the current platform's rules. On Windows this
 * accepts both `C:/Users/...` (the forward-slash form Live writes into
 * Library.cfg) and `C:\Users\...`.
 *
 * @param {string} p
 * @returns {boolean}
 */
function isAbsolutePath(p) {
  return platformPath().isAbsolute(p);
}

/**
 * Directory holding Live's per-version preference folders (`Live 12.0.20/`,
 * each containing a `Library.cfg`).
 *
 * On Windows this is `%APPDATA%\Ableton`. APPDATA is set for any normal
 * interactive session, but fall back to the conventional location rather
 * than producing a path starting with "undefined" if it somehow isn't.
 *
 * @returns {string}
 */
function ablePrefsDir() {
  const p = platformPath();
  const home = os.homedir();
  if (isWindows()) {
    const appData = process.env.APPDATA || p.join(home, 'AppData', 'Roaming');
    return p.join(appData, 'Ableton');
  }
  return p.join(home, 'Library', 'Preferences', 'Ableton');
}

/**
 * Fallback Remote Scripts directory, used when no Library.cfg could be read
 * (Live never launched on this machine, or its User Library sits on an
 * unmounted volume). These are the stock locations Live uses out of the box.
 *
 * @returns {string}
 */
function defaultRemoteScriptsDir() {
  const p = platformPath();
  const home = os.homedir();
  const base = isWindows() ? ['Documents', 'Ableton'] : ['Music', 'Ableton'];
  return p.join(home, ...base, 'User Library', 'Remote Scripts');
}

/**
 * Root of an NVM installation's per-version directories, or null on
 * platforms where we don't probe it. nvm-windows uses a different on-disk
 * layout (`%NVM_HOME%\vX.Y.Z\`, with global npm bins going to a junction
 * rather than a per-version `bin/`), and Windows GUI apps inherit the
 * registry PATH anyway — so the `where.exe` fallback covers it and we skip
 * the probe entirely.
 *
 * @returns {{ versionsDir: string, aliasFile: string }|null}
 */
function nvmPaths() {
  if (isWindows()) return null;
  const p = platformPath();
  const home = os.homedir();
  return {
    versionsDir: p.join(home, '.nvm', 'versions', 'node'),
    aliasFile: p.join(home, '.nvm', 'alias', 'default'),
  };
}

/**
 * Join an NVM version directory to the binary it would contain.
 *
 * @param {string} versionsDir
 * @param {string} version - e.g. "v20.16.0".
 * @param {string} name
 * @returns {string}
 */
function nvmBinPath(versionsDir, version, name) {
  return platformPath().join(versionsDir, version, 'bin', name);
}

/**
 * Well-known absolute install locations for an agent CLI, in probe order.
 *
 * On Windows the list is deliberately short. The macOS list is long because
 * Live launched from launchd inherits no useful PATH, so `command -v` in a
 * non-interactive shell misses NVM/asdf/mise installs. Windows GUI processes
 * inherit the machine + user PATH from the registry, so `where.exe` (see
 * whichCommand) already finds winget / scoop / Chocolatey shims — only the
 * handful of locations that are NOT usually on PATH are worth listing here.
 *
 * @param {string} name - CLI binary name, e.g. "claude".
 * @returns {string[]} Absolute candidate paths.
 */
function binCandidates(name) {
  const p = platformPath();
  const home = os.homedir();
  const dirs = isWindows()
    ? [
        p.join(home, '.local', 'bin'),
        p.join(home, '.opencode', 'bin'),
        p.join(home, '.bun', 'bin'),
        p.join(home, '.cargo', 'bin'),
        p.join(process.env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'npm'),
      ]
    : [
        p.join(home, '.local', 'bin'),
        p.join(home, '.opencode', 'bin'),
        p.join(home, '.bun', 'bin'),
        p.join(home, '.npm-global', 'bin'),
        p.join(home, '.cargo', 'bin'),
        '/usr/local/bin',
        '/opt/homebrew/bin',
      ];
  const extensions = isWindows() ? WINDOWS_BIN_EXTENSIONS : POSIX_BIN_EXTENSIONS;
  const out = [];
  for (const dir of dirs) {
    for (const ext of extensions) {
      out.push(p.join(dir, `${name}${ext}`));
    }
  }
  return out;
}

/**
 * The command to ask the OS where a binary lives, as a spawnable pair.
 *
 * POSIX goes through the user's login shell so that PATH additions made by
 * asdf / mise / custom profiles are picked up. Windows uses `where.exe`,
 * which reports every PATH match, newline-separated, and exits non-zero when
 * there is none.
 *
 * @param {string} name
 * @returns {{ file: string, args: string[] }}
 */
function whichCommand(name) {
  if (isWindows()) {
    return { file: 'where.exe', args: [name] };
  }
  return { file: process.env.SHELL || '/bin/zsh', args: ['-lc', `command -v ${name}`] };
}

/**
 * First usable absolute path in the output of whichCommand(). `where.exe`
 * can report several matches (and terminates lines with CRLF); `command -v`
 * reports one. Anything relative — a shell builtin, an alias, a "not found"
 * message on stdout — is rejected.
 *
 * @param {string} output - Raw stdout.
 * @returns {string|null}
 */
function parseWhichOutput(output) {
  for (const rawLine of String(output).split('\n')) {
    const line = rawLine.trim();
    if (line && isAbsolutePath(line)) return line;
  }
  return null;
}

/**
 * Candidate interpreters for a specific CPython version, in probe order, as
 * spawnable {file, prefixArgs} pairs. Used by the build to produce the .pyc
 * Live loads.
 *
 * Windows gets `py -<version>` first: the py.exe launcher ships with every
 * python.org install and is the only reliable way to select a version, since
 * Windows installs are all named plain `python.exe`. macOS gets the
 * Homebrew / pyenv / system locations where a versioned binary actually
 * exists under that name.
 *
 * @param {string} version - CPython minor version, e.g. "3.11".
 * @returns {Array<{ file: string, prefixArgs: string[] }>}
 */
function pythonCandidates(version) {
  const p = platformPath();
  const home = os.homedir();
  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
    const folder = `Python${version.replace('.', '')}`;
    return [
      { file: 'py', prefixArgs: [`-${version}`] },
      { file: p.join(localAppData, 'Programs', 'Python', folder, 'python.exe'), prefixArgs: [] },
      { file: p.join('C:\\', folder, 'python.exe'), prefixArgs: [] },
      { file: `python${version}.exe`, prefixArgs: [] },
    ];
  }
  return [
    { file: p.join(home, '.local', 'bin', `python${version}`), prefixArgs: [] },
    { file: `/opt/homebrew/bin/python${version}`, prefixArgs: [] },
    { file: `/usr/local/bin/python${version}`, prefixArgs: [] },
    { file: `python${version}`, prefixArgs: [] },
  ];
}

/**
 * Platform-appropriate one-liner telling the user how to install a missing
 * CPython version.
 *
 * @param {string} version - CPython minor version, e.g. "3.11".
 * @returns {string}
 */
function pythonInstallHint(version) {
  return isWindows() ? `winget install Python.Python.${version}` : `brew install python@${version}`;
}

/**
 * Quote one argument for cmd.exe. Only needed for the .cmd/.bat path below:
 * Node builds the shell command line by joining file + args with spaces and
 * does no quoting of its own, so an argument containing spaces (our
 * `Authorization: Bearer <token>` header) would otherwise arrive split.
 *
 * @param {string} arg
 * @returns {string}
 */
function quoteWindowsArg(arg) {
  if (arg !== '' && !/[\s"^&|<>()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Normalise a binary path + args into something `execFile`/`execFileSync` can
 * actually run on this platform.
 *
 * Node refuses to spawn a `.cmd`/`.bat` directly (CVE-2024-27980 hardening:
 * batch files must go through a shell, otherwise spawn fails with EINVAL).
 * npm-installed CLIs on Windows are exactly that — `%APPDATA%\npm\claude.cmd`
 * — so those get `shell: true` plus hand-quoted arguments. Native `.exe`
 * binaries and everything on POSIX are spawned directly, unquoted, as before.
 *
 * @param {string} binPath - Absolute path to the resolved binary.
 * @param {string[]} args
 * @returns {{ file: string, args: string[], options: object }}
 */
function spawnFor(binPath, args) {
  if (isWindows() && /\.(cmd|bat)$/i.test(binPath)) {
    return {
      file: quoteWindowsArg(binPath),
      args: args.map(quoteWindowsArg),
      options: { shell: true },
    };
  }
  return { file: binPath, args, options: {} };
}

module.exports = {
  isWindows,
  platformPath,
  isAbsolutePath,
  ablePrefsDir,
  defaultRemoteScriptsDir,
  nvmPaths,
  nvmBinPath,
  binCandidates,
  whichCommand,
  parseWhichOutput,
  pythonCandidates,
  pythonInstallHint,
  quoteWindowsArg,
  spawnFor,
};
