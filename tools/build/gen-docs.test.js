'use strict';

jest.mock('fs');
jest.mock('child_process');

const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const { generate, jsFiles, DOMAINS } = require('./gen-docs');

beforeEach(() => {
  jest.resetAllMocks();
});

describe('jsFiles', () => {
  it('returns [] when directory does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(jsFiles('app/missing', false)).toEqual([]);
  });

  it('lists .js files in a flat directory', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue([
      { name: 'a.js', isDirectory: () => false, isFile: () => true },
      { name: 'b.txt', isDirectory: () => false, isFile: () => true },
      { name: 'sub', isDirectory: () => true, isFile: () => false },
    ]);
    const out = jsFiles('app/x', false);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('a.js');
  });

  it('recurses into subdirectories when recursive=true', () => {
    fs.existsSync.mockReturnValue(true);
    let depth = 0;
    fs.readdirSync.mockImplementation(() => {
      depth++;
      if (depth === 1) {
        return [
          { name: 'sub', isDirectory: () => true, isFile: () => false },
          { name: 'top.js', isDirectory: () => false, isFile: () => true },
        ];
      }
      return [{ name: 'inner.js', isDirectory: () => false, isFile: () => true }];
    });
    const out = jsFiles('app/x', true);
    expect(out.some((p) => p.endsWith('top.js'))).toBe(true);
    expect(out.some((p) => p.endsWith('inner.js'))).toBe(true);
  });
});

describe('generate', () => {
  it('skips empty domains and writes files for non-empty ones', () => {
    fs.mkdirSync.mockImplementation(() => {});
    // Trick: every domain's `files()` is computed at runtime via fs.readdirSync
    // and fs.existsSync. Make readdirSync return [] (so jsFiles → []) and
    // existsSync return true selectively for explicit paths.
    fs.readdirSync.mockReturnValue([]);
    // Only allow the define.js domain to "exist" so exactly one .md is written.
    fs.existsSync.mockImplementation((p) => p.endsWith(path.join('tools', 'define.js')));
    fs.writeFileSync.mockImplementation(() => {});
    cp.execFileSync.mockReturnValue('# generated md');

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      generate();
    } finally {
      logSpy.mockRestore();
    }

    // README.md is always written.
    const writes = fs.writeFileSync.mock.calls.map((c) => c[0]);
    expect(writes.some((p) => p.endsWith('README.md'))).toBe(true);
    // The non-empty domain (tools-define) was written.
    expect(writes.some((p) => p.endsWith('tools-define.md'))).toBe(true);
    // execFileSync called for documentation build.
    expect(cp.execFileSync).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['documentation', 'build']),
      expect.any(Object),
    );
  });
});

describe('DOMAINS', () => {
  it('exposes the expected slugs in stable order', () => {
    expect(DOMAINS.map((d) => d.slug)).toEqual([
      'lom_router',
      'server-core',
      'tools-define',
      'tools-tracks',
      'tools-clips',
      'tools-other',
      'build-tools',
    ]);
  });

  it('each domain.files() callable returns an array (even when fs is mocked empty)', () => {
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
    for (const d of DOMAINS) {
      expect(Array.isArray(d.files())).toBe(true);
    }
  });
});
