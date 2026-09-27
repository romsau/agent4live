'use strict';

// platform.js is pure path/string computation driven by `process.platform`,
// so every test here pins the platform and asserts the exact output. Both
// branches run on any host — that's the point of the module: a macOS
// maintainer and a Windows contributor get identical results from `npm test`.

const os = require('os');
const path = require('path');
const { onPlatform, p } = require('../../tools/test/with-platform');
const platform = require('./platform');

const HOME = os.homedir();

describe('on macOS', () => {
  onPlatform('darwin');

  it('reports not-Windows and selects the posix path flavour', () => {
    expect(platform.isWindows()).toBe(false);
    expect(platform.platformPath()).toBe(path.posix);
  });

  it('accepts POSIX absolute paths and rejects relative ones', () => {
    expect(platform.isAbsolutePath('/Volumes/SOUND/lib')).toBe(true);
    expect(platform.isAbsolutePath('relative/path')).toBe(false);
  });

  it('points at ~/Library/Preferences/Ableton for Live preferences', () => {
    expect(platform.ablePrefsDir()).toBe(p().join(HOME, 'Library', 'Preferences', 'Ableton'));
  });

  it('defaults the Remote Scripts dir to ~/Music/Ableton/User Library', () => {
    expect(platform.defaultRemoteScriptsDir()).toBe(
      p().join(HOME, 'Music', 'Ableton', 'User Library', 'Remote Scripts'),
    );
  });

  it('exposes the NVM layout', () => {
    expect(platform.nvmPaths()).toEqual({
      versionsDir: p().join(HOME, '.nvm', 'versions', 'node'),
      aliasFile: p().join(HOME, '.nvm', 'alias', 'default'),
    });
  });

  it('builds an NVM bin path', () => {
    expect(platform.nvmBinPath('/nvm/versions/node', 'v20.16.0', 'claude')).toBe(
      '/nvm/versions/node/v20.16.0/bin/claude',
    );
  });

  it('lists suffix-less candidates including Homebrew and /usr/local', () => {
    expect(platform.binCandidates('claude')).toEqual([
      p().join(HOME, '.local', 'bin', 'claude'),
      p().join(HOME, '.opencode', 'bin', 'claude'),
      p().join(HOME, '.bun', 'bin', 'claude'),
      p().join(HOME, '.npm-global', 'bin', 'claude'),
      p().join(HOME, '.cargo', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ]);
  });

  it('asks the login shell from $SHELL', () => {
    const prev = process.env.SHELL;
    process.env.SHELL = '/bin/bash';
    try {
      expect(platform.whichCommand('gemini')).toEqual({
        file: '/bin/bash',
        args: ['-lc', 'command -v gemini'],
      });
    } finally {
      if (prev === undefined) delete process.env.SHELL;
      else process.env.SHELL = prev;
    }
  });

  it('falls back to /bin/zsh when $SHELL is unset', () => {
    const prev = process.env.SHELL;
    delete process.env.SHELL;
    try {
      expect(platform.whichCommand('gemini').file).toBe('/bin/zsh');
    } finally {
      if (prev !== undefined) process.env.SHELL = prev;
    }
  });

  it('probes versioned python filenames and suggests brew', () => {
    expect(platform.pythonCandidates('3.11')).toEqual([
      { file: p().join(HOME, '.local', 'bin', 'python3.11'), prefixArgs: [] },
      { file: '/opt/homebrew/bin/python3.11', prefixArgs: [] },
      { file: '/usr/local/bin/python3.11', prefixArgs: [] },
      { file: 'python3.11', prefixArgs: [] },
    ]);
    expect(platform.pythonInstallHint('3.11')).toBe('brew install python@3.11');
  });

  it('spawns binaries directly, with no shell and no quoting', () => {
    expect(platform.spawnFor('/usr/local/bin/claude', ['mcp', 'add', 'a b'])).toEqual({
      file: '/usr/local/bin/claude',
      args: ['mcp', 'add', 'a b'],
      options: {},
    });
  });

  it('treats a .cmd suffix as an ordinary filename off-Windows', () => {
    expect(platform.spawnFor('/opt/weird.cmd', ['x']).options).toEqual({});
  });
});

describe('on Windows', () => {
  onPlatform('win32');

  it('reports Windows and selects the win32 path flavour', () => {
    expect(platform.isWindows()).toBe(true);
    expect(platform.platformPath()).toBe(path.win32);
  });

  it('accepts drive-letter absolute paths in either slash form', () => {
    // Live writes the forward-slash form into Library.cfg.
    expect(platform.isAbsolutePath('C:/Users/ASUS/Documents/Ableton')).toBe(true);
    expect(platform.isAbsolutePath('C:\\Users\\ASUS\\Documents\\Ableton')).toBe(true);
    expect(platform.isAbsolutePath('relative/path')).toBe(false);
  });

  it('points at %APPDATA%\\Ableton for Live preferences', () => {
    const prev = process.env.APPDATA;
    process.env.APPDATA = 'C:\\Users\\ASUS\\AppData\\Roaming';
    try {
      expect(platform.ablePrefsDir()).toBe('C:\\Users\\ASUS\\AppData\\Roaming\\Ableton');
    } finally {
      if (prev === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = prev;
    }
  });

  it('derives AppData from the home dir when %APPDATA% is unset', () => {
    const prev = process.env.APPDATA;
    delete process.env.APPDATA;
    try {
      expect(platform.ablePrefsDir()).toBe(p().join(HOME, 'AppData', 'Roaming', 'Ableton'));
    } finally {
      if (prev !== undefined) process.env.APPDATA = prev;
    }
  });

  it('defaults the Remote Scripts dir to ~\\Documents\\Ableton\\User Library', () => {
    // NOT ~/Music — that is the macOS location, and Live on Windows never
    // scans it. This is the bug that made the Control Surface invisible.
    expect(platform.defaultRemoteScriptsDir()).toBe(
      p().join(HOME, 'Documents', 'Ableton', 'User Library', 'Remote Scripts'),
    );
  });

  it('skips the NVM probe (nvm-windows has a different layout)', () => {
    expect(platform.nvmPaths()).toBeNull();
  });

  it('lists .exe before .cmd before .bat in every candidate dir', () => {
    const prev = process.env.APPDATA;
    process.env.APPDATA = 'C:\\AppData';
    try {
      const candidates = platform.binCandidates('claude');
      expect(candidates).toContain(p().join(HOME, '.local', 'bin', 'claude.exe'));
      expect(candidates).toContain('C:\\AppData\\npm\\claude.cmd');
      // .exe wins over the .cmd shim in the same directory.
      const localExe = candidates.indexOf(p().join(HOME, '.local', 'bin', 'claude.exe'));
      const localCmd = candidates.indexOf(p().join(HOME, '.local', 'bin', 'claude.cmd'));
      const localBat = candidates.indexOf(p().join(HOME, '.local', 'bin', 'claude.bat'));
      expect(localExe).toBeLessThan(localCmd);
      expect(localCmd).toBeLessThan(localBat);
      // 5 dirs x 3 extensions.
      expect(candidates).toHaveLength(15);
      expect(candidates.every((c) => /\.(exe|cmd|bat)$/.test(c))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = prev;
    }
  });

  it('derives the npm dir from the home dir when %APPDATA% is unset', () => {
    const prev = process.env.APPDATA;
    delete process.env.APPDATA;
    try {
      expect(platform.binCandidates('claude')).toContain(
        p().join(HOME, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      );
    } finally {
      if (prev !== undefined) process.env.APPDATA = prev;
    }
  });

  it('asks where.exe instead of a login shell', () => {
    expect(platform.whichCommand('claude')).toEqual({ file: 'where.exe', args: ['claude'] });
  });

  it('leads with the py.exe launcher and suggests winget', () => {
    const prev = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = 'C:\\Users\\ASUS\\AppData\\Local';
    try {
      expect(platform.pythonCandidates('3.11')).toEqual([
        { file: 'py', prefixArgs: ['-3.11'] },
        {
          file: 'C:\\Users\\ASUS\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
          prefixArgs: [],
        },
        { file: 'C:\\Python311\\python.exe', prefixArgs: [] },
        { file: 'python3.11.exe', prefixArgs: [] },
      ]);
      expect(platform.pythonInstallHint('3.11')).toBe('winget install Python.Python.3.11');
    } finally {
      if (prev === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = prev;
    }
  });

  it('derives LocalAppData from the home dir when %LOCALAPPDATA% is unset', () => {
    const prev = process.env.LOCALAPPDATA;
    delete process.env.LOCALAPPDATA;
    try {
      expect(platform.pythonCandidates('3.11')[1].file).toBe(
        p().join(HOME, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
      );
    } finally {
      if (prev !== undefined) process.env.LOCALAPPDATA = prev;
    }
  });

  it('spawns .exe directly, exactly as on POSIX', () => {
    expect(platform.spawnFor('C:\\bin\\claude.exe', ['mcp', 'add'])).toEqual({
      file: 'C:\\bin\\claude.exe',
      args: ['mcp', 'add'],
      options: {},
    });
  });

  it('runs .cmd shims through a shell with quoted arguments', () => {
    // Node refuses to spawn a batch file directly (EINVAL), and does no
    // quoting of its own under shell:true — so the Bearer header, which
    // contains spaces, must arrive pre-quoted or it gets split.
    const spawn = platform.spawnFor('C:\\Users\\a b\\npm\\claude.cmd', [
      'mcp',
      'add',
      '--header',
      'Authorization: Bearer deadbeef',
    ]);
    expect(spawn.options).toEqual({ shell: true });
    expect(spawn.file).toBe('"C:\\Users\\a b\\npm\\claude.cmd"');
    expect(spawn.args).toEqual(['mcp', 'add', '--header', '"Authorization: Bearer deadbeef"']);
  });

  it('runs .bat shims through a shell too, case-insensitively', () => {
    expect(platform.spawnFor('C:\\bin\\claude.BAT', []).options).toEqual({ shell: true });
  });
});

describe('parseWhichOutput', () => {
  onPlatform('win32');

  it('takes the first match from multi-line CRLF where.exe output', () => {
    expect(platform.parseWhichOutput('C:\\bin\\claude.exe\r\nC:\\other\\claude.cmd\r\n')).toBe(
      'C:\\bin\\claude.exe',
    );
  });

  it('returns null when nothing absolute is reported', () => {
    expect(platform.parseWhichOutput('')).toBeNull();
    expect(platform.parseWhichOutput('\r\n  \r\n')).toBeNull();
    expect(platform.parseWhichOutput('INFO: Could not find files.')).toBeNull();
  });
});

describe('quoteWindowsArg', () => {
  it('leaves simple arguments untouched', () => {
    expect(platform.quoteWindowsArg('mcp')).toBe('mcp');
    expect(platform.quoteWindowsArg('--scope')).toBe('--scope');
  });

  it('quotes anything containing whitespace or cmd metacharacters', () => {
    expect(platform.quoteWindowsArg('a b')).toBe('"a b"');
    expect(platform.quoteWindowsArg('a&b')).toBe('"a&b"');
    expect(platform.quoteWindowsArg('a|b')).toBe('"a|b"');
  });

  it('quotes the empty string so it survives as an argument', () => {
    expect(platform.quoteWindowsArg('')).toBe('""');
  });

  it('escapes embedded double quotes', () => {
    expect(platform.quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
  });
});
