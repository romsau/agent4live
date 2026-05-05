'use strict';

// Jest config for agent4live. The codebase is CommonJS targeting Node 20 ;
// no transpilation needed — Jest runs the source files directly.
//
// Tests live co-located with the source under `app/` and `tools/` (e.g.
// app/server/lom/queue.test.js next to queue.js). Files matching the test
// pattern below are picked up automatically.

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(test).js'],
  // dist/ is the build output (generated, never touched at test time).
  // node_modules/ is excluded by default.
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // Redirect runtime-only modules to test stubs. max-api is provided by Max
  // for Live at runtime ; tests can't load the real package.
  moduleNameMapper: {
    '^max-api$': '<rootDir>/tools/test/max-api-stub.js',
  },
  // Pre-load Max [js] globals (LiveAPI / Dict / Task / outlet / etc.) so
  // tests can require app/lom_router/* directly. Per-test overrides remain
  // possible via `global.LiveAPI = jest.fn()...`.
  setupFiles: ['<rootDir>/tools/test/max-runtime-stubs.js'],
  // .html requires (server/ui/state.js loads active.html / passive.html as
  // strings) need a transformer — see jest-html-transformer.js.
  transform: {
    // Same transformer for .html (server/ui/active.html etc), .py
    // (python_scripts/__init__.py), and .md (server/skill/*.md) — all end
    // up as string literals.
    '\\.(html|py|md)$': '<rootDir>/tools/build/jest-html-transformer.js',
  },
  // Coverage runs by default (`npm test`). Scope = everything in app/ and
  // tools/, including the Max [js] handlers (testable via the runtime stubs)
  // and meta-tooling. Only test infrastructure itself is excluded.
  collectCoverageFrom: [
    'app/**/*.js',
    'tools/**/*.js',
    '!app/lom_router.js',
    '!tools/test/**',
    '!tools/build/jest-html-transformer.js',
    '!jest.config.js',
    '!**/*.test.js',
  ],
  coverageDirectory: 'coverage',
  // 100% target — every covered file must hit 100% of statements / branches /
  // functions / lines. Anything below fails `npm test`. Loosen this only after
  // discussion ; the goal is to keep the gate tight enough that adding code
  // without tests is uncomfortable.
  coverageThreshold: {
    global: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
};
