'use strict';

jest.mock('fs');
jest.mock('./bridge', () => ({ isAlive: jest.fn() }));

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isAlive } = require('./bridge');
const extension = require('./install');

const HOME = os.homedir();
const DEFAULT_USER_LIB = path.join(HOME, 'Music', 'Ableton', 'User Library');
const DEFAULT_REMOTE_SCRIPTS_DIR = path.join(DEFAULT_USER_LIB, 'Remote Scripts');
const DEFAULT_SCRIPT_PY = path.join(DEFAULT_REMOTE_SCRIPTS_DIR, 'agent4live', '__init__.py');
const DEFAULT_SCRIPT_PYC = path.join(DEFAULT_REMOTE_SCRIPTS_DIR, 'agent4live', '__init__.pyc');
const ABLETON_PREFS_DIR = path.join(HOME, 'Library', 'Preferences', 'Ableton');

// Helper: install a `fs.existsSync` mock that returns `true` only for paths
// whose suffix matches one in `truePaths`. Default-true tests don't need
// the helper; this is for the more granular tests that check fallback paths.
function existsSyncOnly(...truePaths) {
  fs.existsSync.mockImplementation((p) => truePaths.some((t) => p.endsWith(t)));
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no Live preferences on disk → resolver falls back to default.
  // Tests that exercise the resolver override this.
  fs.readdirSync.mockImplementation(() => {
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  });
});

describe('_parseUserLibraryFromCfg', () => {
  it('returns null when cfg cannot be read', () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(extension._parseUserLibraryFromCfg('/x/Library.cfg')).toBeNull();
  });

  it('returns null when the UserLibrary section is missing', () => {
    fs.readFileSync.mockReturnValue('<?xml version="1.0"?><Ableton></Ableton>');
    expect(extension._parseUserLibraryFromCfg('/x/Library.cfg')).toBeNull();
  });

  it('returns null when the ProjectPath is relative (defense against malformed cfg)', () => {
    fs.readFileSync.mockReturnValue(
      '<UserLibrary><LibraryProject><ProjectPath Value="relative/path"/></LibraryProject></UserLibrary>',
    );
    expect(extension._parseUserLibraryFromCfg('/x/Library.cfg')).toBeNull();
  });

  it('returns projectPath + projectName when both are present', () => {
    fs.readFileSync.mockReturnValue(
      [
        '<UserLibrary>',
        '<LibraryProject>',
        '<ProjectName Value="User Library"/>',
        '<ProjectPath Value="/Volumes/SOUND/ableton user lib"/>',
        '</LibraryProject>',
        '</UserLibrary>',
      ].join('\n'),
    );
    expect(extension._parseUserLibraryFromCfg('/x/Library.cfg')).toEqual({
      projectPath: '/Volumes/SOUND/ableton user lib',
      projectName: 'User Library',
    });
  });

  it('defaults projectName to "User Library" when missing', () => {
    fs.readFileSync.mockReturnValue(
      '<UserLibrary><LibraryProject><ProjectPath Value="/abs/path"/></LibraryProject></UserLibrary>',
    );
    expect(extension._parseUserLibraryFromCfg('/x/Library.cfg')).toEqual({
      projectPath: '/abs/path',
      projectName: 'User Library',
    });
  });

  it('handles default Ableton install (ProjectPath is the parent of User Library)', () => {
    fs.readFileSync.mockReturnValue(
      [
        '<UserLibrary>',
        '<LibraryProject Id="0">',
        '<ProjectLocation/>',
        '<ProjectName Value="User Library"/>',
        '<ProjectPath Value="/Users/x/Music/Ableton"/>',
        '</LibraryProject>',
        '</UserLibrary>',
      ].join('\n'),
    );
    expect(extension._parseUserLibraryFromCfg('/x/Library.cfg')).toEqual({
      projectPath: '/Users/x/Music/Ableton',
      projectName: 'User Library',
    });
  });
});

describe('resolveRemoteScriptsDir', () => {
  it('falls back to default when ~/Library/Preferences/Ableton is absent', () => {
    fs.readdirSync.mockImplementation(() => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    expect(extension.resolveRemoteScriptsDir()).toBe(DEFAULT_REMOTE_SCRIPTS_DIR);
  });

  it('falls back to default when no "Live X.Y" prefs dir exists', () => {
    fs.readdirSync.mockReturnValue(['.DS_Store', 'SomeOtherApp']);
    expect(extension.resolveRemoteScriptsDir()).toBe(DEFAULT_REMOTE_SCRIPTS_DIR);
  });

  it('falls back to default when Live X.Y dir has no Library.cfg', () => {
    fs.readdirSync.mockReturnValue(['Live 12.4']);
    fs.statSync.mockImplementation(() => {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    expect(extension.resolveRemoteScriptsDir()).toBe(DEFAULT_REMOTE_SCRIPTS_DIR);
  });

  it('reads ProjectPath from the most recently modified Library.cfg', () => {
    fs.readdirSync.mockReturnValue(['Live 12.3.8', 'Live 12.4', 'Live 11.3.42']);
    fs.statSync.mockImplementation((p) => {
      if (p.includes('Live 12.4')) return { mtimeMs: 3000 };
      if (p.includes('Live 12.3.8')) return { mtimeMs: 2000 };
      if (p.includes('Live 11.3.42')) return { mtimeMs: 1000 };
      throw new Error('unexpected statSync');
    });
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('Live 12.4')) {
        return '<UserLibrary><LibraryProject><ProjectPath Value="/Volumes/SOUND/lib"/></LibraryProject></UserLibrary>';
      }
      throw new Error('should not have read older cfg');
    });
    // We check the ProjectPath exists (volume mounted), not the User Library
    // sub-folder — installExtension creates the latter recursively if needed.
    fs.existsSync.mockImplementation((p) => p === '/Volumes/SOUND/lib');
    expect(extension.resolveRemoteScriptsDir()).toBe(
      '/Volumes/SOUND/lib/User Library/Remote Scripts',
    );
  });

  it('uses the cfg whose ProjectPath is mounted, skipping unmounted volumes', () => {
    fs.readdirSync.mockReturnValue(['Live 12.4', 'Live 12.3.8']);
    fs.statSync.mockImplementation((p) => {
      if (p.includes('Live 12.4')) return { mtimeMs: 3000 };
      if (p.includes('Live 12.3.8')) return { mtimeMs: 2000 };
      throw new Error('unexpected statSync');
    });
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('Live 12.4')) {
        return '<UserLibrary><LibraryProject><ProjectPath Value="/Volumes/MISSING/lib"/></LibraryProject></UserLibrary>';
      }
      if (p.includes('Live 12.3.8')) {
        return `<UserLibrary><LibraryProject><ProjectPath Value="${HOME}/Music/Ableton"/></LibraryProject></UserLibrary>`;
      }
      throw new Error('unexpected readFileSync');
    });
    // /Volumes/MISSING is unmounted → skip. ~/Music/Ableton is the default
    // parent and exists → use it.
    fs.existsSync.mockImplementation((p) => p === path.join(HOME, 'Music', 'Ableton'));
    expect(extension.resolveRemoteScriptsDir()).toBe(DEFAULT_REMOTE_SCRIPTS_DIR);
  });

  it('falls back to default when every candidate cfg points to a missing ProjectPath', () => {
    fs.readdirSync.mockReturnValue(['Live 12.4']);
    fs.statSync.mockReturnValue({ mtimeMs: 1 });
    fs.readFileSync.mockReturnValue(
      '<UserLibrary><LibraryProject><ProjectPath Value="/Volumes/GONE/lib"/></LibraryProject></UserLibrary>',
    );
    fs.existsSync.mockReturnValue(false);
    expect(extension.resolveRemoteScriptsDir()).toBe(DEFAULT_REMOTE_SCRIPTS_DIR);
  });

  it('resolves correctly when the User Library sub-folder does not yet exist (Live will create it)', () => {
    // Real-world Mac 2 scenario : volume mounted at ProjectPath, but the
    // "User Library" sub-folder hasn't been materialised yet by Live.
    fs.readdirSync.mockReturnValue(['Live 12.4']);
    fs.statSync.mockReturnValue({ mtimeMs: 1 });
    fs.readFileSync.mockReturnValue(
      '<UserLibrary><LibraryProject><ProjectPath Value="/Volumes/SOUND/ableton user lib"/></LibraryProject></UserLibrary>',
    );
    fs.existsSync.mockImplementation((p) => p === '/Volumes/SOUND/ableton user lib');
    expect(extension.resolveRemoteScriptsDir()).toBe(
      '/Volumes/SOUND/ableton user lib/User Library/Remote Scripts',
    );
  });
});

describe('getExtensionStatus', () => {
  it('script absent → scriptInstalled=false, pingOk=false (no ping attempted)', async () => {
    fs.existsSync.mockReturnValue(false);
    expect(await extension.getExtensionStatus()).toEqual({
      scriptInstalled: false,
      pingOk: false,
    });
    expect(isAlive).not.toHaveBeenCalled();
  });

  it('script present + ping ok → both true', async () => {
    fs.existsSync.mockReturnValue(true);
    isAlive.mockResolvedValue(true);
    expect(await extension.getExtensionStatus()).toEqual({
      scriptInstalled: true,
      pingOk: true,
    });
  });

  it('script present + ping ko → scriptInstalled=true, pingOk=false', async () => {
    fs.existsSync.mockReturnValue(true);
    isAlive.mockResolvedValue(false);
    expect(await extension.getExtensionStatus()).toEqual({
      scriptInstalled: true,
      pingOk: false,
    });
  });

  it('checks the script path under the custom User Library when Library.cfg points to one', async () => {
    fs.readdirSync.mockReturnValue(['Live 12.4']);
    fs.statSync.mockReturnValue({ mtimeMs: 1 });
    fs.readFileSync.mockReturnValue(
      '<UserLibrary><LibraryProject><ProjectPath Value="/Volumes/SOUND/lib"/></LibraryProject></UserLibrary>',
    );
    const customScriptPy = '/Volumes/SOUND/lib/User Library/Remote Scripts/agent4live/__init__.py';
    // ProjectPath mounted + scriptPy on disk → resolved + scriptInstalled=true.
    existsSyncOnly('/Volumes/SOUND/lib', customScriptPy);
    isAlive.mockResolvedValue(true);
    expect(await extension.getExtensionStatus()).toEqual({
      scriptInstalled: true,
      pingOk: true,
    });
    expect(fs.existsSync).toHaveBeenCalledWith(customScriptPy);
  });
});

describe('installExtension', () => {
  const PY = '# python source';
  const PYC = new Uint8Array([0xa7, 0x0d, 0x0d, 0x0a, 0x01, 0x02]);

  beforeEach(() => {
    fs.existsSync.mockImplementation((p) => p.includes('User Library'));
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
  });

  it('writes the .py + .pyc and returns ok', async () => {
    const r = await extension.installExtension(PY, PYC);
    expect(r).toEqual({ ok: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(DEFAULT_SCRIPT_PY, PY, 'utf8');
    expect(fs.writeFileSync).toHaveBeenCalledWith(DEFAULT_SCRIPT_PYC, expect.any(Buffer));
    const pycCall = fs.writeFileSync.mock.calls.find((c) => c[0] === DEFAULT_SCRIPT_PYC);
    expect(pycCall[1].equals(Buffer.from(PYC))).toBe(true);
  });

  it('returns ok=false when writeFileSync throws', async () => {
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    const r = await extension.installExtension(PY, PYC);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disk full/);
  });

  it('creates Remote Scripts dir if missing', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    const r = await extension.installExtension(PY, PYC);
    expect(r.ok).toBe(true);
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('Remote Scripts'), {
      recursive: true,
    });
  });

  it('returns ok=false when Remote Scripts dir cannot be created', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const r = await extension.installExtension(PY, PYC);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot create/);
  });

  it('writes to the custom Remote Scripts dir from Library.cfg', async () => {
    fs.readdirSync.mockReturnValue(['Live 12.4']);
    fs.statSync.mockReturnValue({ mtimeMs: 1 });
    fs.readFileSync.mockReturnValue(
      '<UserLibrary><LibraryProject><ProjectPath Value="/Volumes/SOUND/lib"/></LibraryProject></UserLibrary>',
    );
    const customProjectPath = '/Volumes/SOUND/lib';
    const customRemoteScripts = '/Volumes/SOUND/lib/User Library/Remote Scripts';
    const customScriptPy = path.join(customRemoteScripts, 'agent4live', '__init__.py');
    const customScriptPyc = path.join(customRemoteScripts, 'agent4live', '__init__.pyc');
    // Volume mounted (ProjectPath visible) + Remote Scripts dir already
    // exists → installExtension skips the mkdir of REMOTE_SCRIPTS_DIR but
    // still mkdir's the agent4live sub-folder.
    fs.existsSync.mockImplementation((p) => p === customProjectPath || p === customRemoteScripts);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    const r = await extension.installExtension(PY, PYC);
    expect(r).toEqual({ ok: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(customScriptPy, PY, 'utf8');
    expect(fs.writeFileSync).toHaveBeenCalledWith(customScriptPyc, expect.any(Buffer));
  });
});

describe('module exports', () => {
  it('exposes ABLETON_PREFS_DIR + DEFAULT_REMOTE_SCRIPTS_DIR for tooling', () => {
    expect(extension.ABLETON_PREFS_DIR).toBe(ABLETON_PREFS_DIR);
    expect(extension.DEFAULT_REMOTE_SCRIPTS_DIR).toBe(DEFAULT_REMOTE_SCRIPTS_DIR);
  });
});
