'use strict';

jest.mock('child_process');

const cp = require('child_process');
const { lint } = require('./lint-docs');

beforeEach(() => {
  jest.clearAllMocks();
  cp.execFileSync.mockReset();
});

/**
 * Run lint() with console.log captured. Returns the joined log lines.
 * Restores after capturing so failures don't pollute Jest's reporter.
 */
function captureLint() {
  const calls = [];
  const orig = console.log;
  console.log = (...args) => calls.push(args);
  try {
    lint();
  } finally {
    console.log = orig;
  }
  return calls.flat().join('\n');
}

describe('lint', () => {
  it('logs the "no diagnostic warnings" line when stdout is empty', () => {
    cp.execFileSync.mockReturnValue('');
    expect(captureLint()).toContain('no diagnostic warnings');
  });

  it('groups warnings by file path and prints the count', () => {
    cp.execFileSync.mockReturnValue(
      [
        '/abs/path/file-a.js',
        '  10:1  warning  Missing description',
        '  20:1  warning  object found, Object is standard',
        '/abs/path/file-b.js',
        '  5:1   warning  Bad tag',
        '⚠ 2 warnings',
      ].join('\n'),
    );
    const out = captureLint();
    expect(out).toContain('Missing description');
    expect(out).toContain('Bad tag');
    expect(out).not.toContain('object found, Object is standard');
    expect(out).toContain('2 warning(s)');
  });

  it('falls back to err.stdout + err.stderr when execFileSync throws', () => {
    cp.execFileSync.mockImplementation(() => {
      const err = new Error('non-zero exit');
      err.stdout = '/abs/file.js\n  1:1  warning  X\n';
      err.stderr = '';
      throw err;
    });
    expect(captureLint()).toContain('warning  X');
  });

  it('handles err with neither stdout nor stderr', () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(captureLint()).toContain('no diagnostic warnings');
  });

  it('accepts Windows-style absolute paths as file headers', () => {
    cp.execFileSync.mockReturnValue('C:\\path\\file.js\n  1:1  warning  Z\n');
    const out = captureLint();
    expect(out).toContain('warning  Z');
    expect(out).toContain('C:\\path\\file.js');
  });

  it('drops files whose only warnings are noise (no header in output)', () => {
    cp.execFileSync.mockReturnValue(['/abs/file.js', '  1:1 warning unexpected token'].join('\n'));
    expect(captureLint()).toContain('no diagnostic warnings');
  });
});
