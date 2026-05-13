'use strict';

// compile-extension-pyc.js shells out to python3.11 at build time. We mock fs
// and child_process so the test never actually invokes Python.

jest.mock('fs');
jest.mock('child_process');

const fs = require('fs');
const { execFileSync } = require('child_process');

const { compile, findPython311, PY_SRC, PYC_OUT } = require('./compile-extension-pyc');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findPython311', () => {
  it('returns the first candidate that reports (3, 11)', () => {
    execFileSync.mockImplementation(() => '(3, 11)\n');
    expect(findPython311()).toMatch(/python3\.11$/);
    // First candidate matches → only one execFileSync call.
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it('skips candidates that throw and the ones that report a different version', () => {
    let call = 0;
    execFileSync.mockImplementation(() => {
      call++;
      if (call === 1) throw new Error('ENOENT');
      if (call === 2) return '(3, 9)\n';
      return '(3, 11)\n';
    });
    expect(findPython311()).toBeTruthy();
    expect(execFileSync).toHaveBeenCalledTimes(3);
  });

  it('throws a clear message when no candidate matches', () => {
    execFileSync.mockImplementation(() => '(3, 9)\n');
    expect(() => findPython311()).toThrow(/python3\.11 not found/);
  });
});

describe('compile', () => {
  it('throws when the source file is missing', () => {
    fs.existsSync.mockReturnValue(false);
    expect(() => compile()).toThrow(/source not found/);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('locates python3.11 and invokes py_compile with src + cfile', () => {
    fs.existsSync.mockReturnValue(true);
    // First call = version probe (returns (3, 11)), second call = py_compile.
    execFileSync.mockImplementation(() => '(3, 11)\n');
    compile();
    // Two calls : probe + actual compilation.
    expect(execFileSync).toHaveBeenCalledTimes(2);
    const compileCall = execFileSync.mock.calls[1];
    expect(compileCall[1][0]).toBe('-c');
    expect(compileCall[1][1]).toContain('py_compile.compile');
    expect(compileCall[1][1]).toContain(JSON.stringify(PY_SRC));
    expect(compileCall[1][1]).toContain(JSON.stringify(PYC_OUT));
  });
});
