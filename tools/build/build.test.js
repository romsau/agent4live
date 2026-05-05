'use strict';

// build.js is a top-level script that bundles app/index.js with esbuild and
// stages dist/. We mock fs + esbuild + concat-lom so the test never touches
// the real filesystem.

jest.mock('fs');
jest.mock('./concat-lom', () => ({ concat: jest.fn() }));
jest.mock('./compile-companion-pyc', () => ({ compile: jest.fn() }));

const fs = require('fs');
const path = require('path');

// Mock the esbuild module that build.js loads dynamically via require(node_modules/esbuild).
const esbuildMock = {
  build: jest.fn(async () => ({
    outputFiles: [{ text: 'BUNDLED_JS_CONTENT' }],
  })),
};
const esbuildPath = path.join(__dirname, '..', '..', 'node_modules', 'esbuild');
jest.doMock(esbuildPath, () => esbuildMock, { virtual: true });

const { main } = require('./build');
const { concat } = require('./concat-lom');
const { compile: compilePyc } = require('./compile-companion-pyc');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('build main()', () => {
  it('runs concat-lom, esbuild bundle, copies amxd, writes both bundle and lom_router', async () => {
    fs.mkdirSync.mockImplementation(() => {});
    fs.readFileSync.mockReturnValue('LOM_ROUTER_SOURCE');
    fs.copyFileSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await main();
    } finally {
      logSpy.mockRestore();
    }

    expect(concat).toHaveBeenCalled();
    expect(compilePyc).toHaveBeenCalled();
    expect(esbuildMock.build).toHaveBeenCalledWith(
      expect.objectContaining({
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        external: expect.arrayContaining(['max-api', 'http', 'fs', 'crypto']),
        loader: { '.html': 'text', '.py': 'text', '.pyc': 'binary', '.md': 'text' },
        write: false,
      }),
    );
    expect(fs.copyFileSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('staging', 'index.js')),
      'BUNDLED_JS_CONTENT',
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('staging', 'lom_router.js')),
      'LOM_ROUTER_SOURCE',
    );
  });
});
