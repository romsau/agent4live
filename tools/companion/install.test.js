'use strict';

jest.mock('fs');
jest.mock('child_process');

const fs = require('fs');
const cp = require('child_process');

// No jest.resetModules() — that would re-require fs/child_process inside
// install.js and dissociate from our `fs.X.mockImplementation()` calls.
const installer = require('./install');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findPython311', () => {
  it('returns the first candidate that prints (3, 11)', () => {
    cp.execFileSync.mockImplementation((bin) => {
      if (bin.endsWith('python3.11')) return '(3, 11)\n';
      throw new Error('not found');
    });
    expect(installer.findPython311()).toMatch(/python3\.11$/);
  });

  it('returns null when no candidate matches 3.11', () => {
    cp.execFileSync.mockImplementation(() => '(3, 9)\n');
    expect(installer.findPython311()).toBeNull();
  });

  it('returns null when every candidate throws', () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(installer.findPython311()).toBeNull();
  });
});

describe('copyDirRecursive', () => {
  it('copies files and recurses into subdirectories', () => {
    fs.mkdirSync.mockImplementation(() => {});
    fs.copyFileSync.mockImplementation(() => {});
    let depth = 0;
    fs.readdirSync.mockImplementation(() => {
      depth++;
      if (depth === 1) {
        return [
          { name: 'a.py', isDirectory: () => false, isFile: () => true },
          { name: 'sub', isDirectory: () => true, isFile: () => false },
        ];
      }
      return [{ name: 'b.py', isDirectory: () => false, isFile: () => true }];
    });
    installer.copyDirRecursive('/src', '/dst');
    expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
    expect(fs.mkdirSync).toHaveBeenCalledWith('/dst', { recursive: true });
  });

  it('skips entries that are neither files nor directories', () => {
    fs.mkdirSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([
      { name: 'fifo', isDirectory: () => false, isFile: () => false },
    ]);
    installer.copyDirRecursive('/src', '/dst');
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });
});

describe('main()', () => {
  let exitSpy, logSpy, errSpy, originalArgv;

  beforeEach(() => {
    originalArgv = process.argv;
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error('process.exit:' + code);
    });
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('exits 1 if the Ableton User Library is not present', () => {
    process.argv = ['node', 'install.js'];
    fs.existsSync.mockReturnValue(false);
    expect(() => installer.main()).toThrow('process.exit:1');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('User Library not found'));
  });

  it('--uninstall removes the target dir when it exists', () => {
    process.argv = ['node', 'install.js', '--uninstall'];
    fs.existsSync.mockImplementation(() => true);
    fs.rmSync.mockImplementation(() => {});
    installer.main();
    expect(fs.rmSync).toHaveBeenCalledWith(installer.TARGET, { recursive: true, force: true });
  });

  it('--uninstall is a no-op when the target dir is missing', () => {
    process.argv = ['node', 'install.js', '--uninstall'];
    fs.existsSync.mockImplementation((p) => p === installer.USER_LIBRARY);
    installer.main();
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it('install: copies files, finds python3.11, compiles .pyc', () => {
    process.argv = ['node', 'install.js'];
    fs.existsSync.mockImplementation((p) => p === installer.USER_LIBRARY);
    fs.mkdirSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([
      { name: '__init__.py', isDirectory: () => false, isFile: () => true },
    ]);
    fs.copyFileSync.mockImplementation(() => {});
    cp.execFileSync.mockImplementation((bin) => {
      if (bin.endsWith('python3.11')) return '(3, 11)\n';
      throw new Error('not found');
    });
    installer.main();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Installed to'));
  });

  it('install: exits 1 when no python3.11 is available', () => {
    process.argv = ['node', 'install.js'];
    fs.existsSync.mockImplementation((p) => p === installer.USER_LIBRARY);
    fs.mkdirSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([]);
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(() => installer.main()).toThrow('process.exit:1');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('python3.11'));
  });

  it('install: exits 1 when py_compile fails', () => {
    process.argv = ['node', 'install.js'];
    fs.existsSync.mockImplementation((p) => p === installer.USER_LIBRARY);
    fs.mkdirSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([]);
    let count = 0;
    cp.execFileSync.mockImplementation((bin) => {
      count++;
      if (count === 1 && bin.endsWith('python3.11')) return '(3, 11)\n';
      throw new Error('compile failed');
    });
    expect(() => installer.main()).toThrow('process.exit:1');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('py_compile failed:'),
      expect.any(String),
    );
  });
});
