'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { concat } = require('./concat-lom');

describe('concat-lom', () => {
  // The script reads/writes inside the real repo. We patch fs so the test
  // doesn't touch app/lom_router.js, then assert the produced output buffer.
  let written;
  let writePath;

  function patchFs(filesByName) {
    jest.spyOn(fs, 'readdirSync').mockReturnValue(Object.keys(filesByName).sort());
    jest.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      const name = path.basename(p);
      return filesByName[name];
    });
    jest.spyOn(fs, 'writeFileSync').mockImplementation((p, data) => {
      writePath = p;
      written = data;
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
    written = undefined;
    writePath = undefined;
  });

  it('concatenates *.js files in alphabetical order with banners + AUTO-GENERATED header', () => {
    patchFs({
      '00_helpers.js': 'function a() {}\n',
      '20_b.js': 'function b() {}\n\n',
      '10_a.js': 'function aa() {}',
    });
    concat();
    expect(writePath.endsWith(path.join('app', 'lom_router.js'))).toBe(true);
    expect(written).toMatch(/AUTO-GENERATED/);
    // Order: 00 < 10 < 20.
    const idx00 = written.indexOf('from 00_helpers.js');
    const idx10 = written.indexOf('from 10_a.js');
    const idx20 = written.indexOf('from 20_b.js');
    expect(idx00).toBeLessThan(idx10);
    expect(idx10).toBeLessThan(idx20);
    // Each file content is in.
    expect(written).toContain('function a() {}');
    expect(written).toContain('function aa() {}');
    expect(written).toContain('function b() {}');
    // Output ends with exactly one trailing newline.
    expect(written.endsWith('\n')).toBe(true);
    expect(written.endsWith('\n\n')).toBe(false);
  });

  it('skips .test.js files (would otherwise leak Jest code into the Max bundle)', () => {
    patchFs({
      '00_helpers.js': 'var x = 1;',
      '00_helpers.test.js': 'describe("foo", () => {});',
    });
    concat();
    expect(written).toContain('00_helpers.js');
    expect(written).not.toContain('describe("foo"');
    expect(written).not.toContain('00_helpers.test.js');
  });

  it('strips CJS export blocks (Max [js] = SpiderMonkey ES5, no shorthand)', () => {
    patchFs({
      '00_helpers.js':
        'function foo() {}\n\n// CJS export — only fires under Jest.\nif (typeof module !== "undefined") {\n  module.exports = { foo };\n}\n',
    });
    concat();
    expect(written).toContain('function foo() {}');
    expect(written).not.toContain('module.exports');
    expect(written).not.toContain('// CJS export');
  });

  it('exposes a CLI entry point that prints "regenerated" when run as main', () => {
    // We can't easily flip require.main, so we just verify the module exports
    // the function and the file does not throw on require — the require has
    // already happened by the time this test runs.
    const mod = require('./concat-lom');
    expect(typeof mod.concat).toBe('function');
  });
});

describe('concat-lom CLI smoke (real repo)', () => {
  // Run the concat against the real repo to verify output is well-formed and
  // not corrupted (and to cover the CLI branch via a child process).
  it('regenerates app/lom_router.js without error when run as a script', () => {
    const repoApp = path.resolve(__dirname, '..', '..', 'app', 'lom_router.js');
    const before = fs.readFileSync(repoApp, 'utf8');
    const tmpBackup = path.join(os.tmpdir(), `lom_router-backup-${process.pid}.js`);
    fs.writeFileSync(tmpBackup, before);
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync('node', [path.resolve(__dirname, 'concat-lom.js')], {
        encoding: 'utf8',
      });
      expect(out).toContain('lom_router.js regenerated');
      const after = fs.readFileSync(repoApp, 'utf8');
      expect(after).toMatch(/AUTO-GENERATED/);
      // No test file was leaked.
      expect(after).not.toMatch(/\.test\.js/);
      // No ES6+ constructs that Max [js] (SpiderMonkey ES5) cannot parse.
      // The CJS export blocks must have been stripped during concat.
      expect(after).not.toContain('module.exports');
    } finally {
      // Restore the original file regardless of test outcome.
      fs.writeFileSync(repoApp, before);
      fs.unlinkSync(tmpBackup);
    }
  });
});
