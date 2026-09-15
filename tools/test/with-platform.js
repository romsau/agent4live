'use strict';

// Test helper: temporarily pin `process.platform` so the OS-dependent paths
// in app/server/platform.js can be asserted from any host. Without this the
// suite only ever exercises whichever branch CI happens to run on, and the
// 100 % branch threshold would be unreachable for the other platform.
//
// `process.platform` is a plain value property, so redefining it is the
// standard idiom — jest.spyOn(..., 'get') doesn't apply.
//
// Usage:
//   const { onPlatform } = require('../../tools/test/with-platform');
//   describe('...', () => {
//     onPlatform('win32');   // restores itself in afterAll
//     it('...', () => { ... });
//   });

const path = require('path');

/**
 * Pin `process.platform` to `value` and return a restore function.
 *
 * @param {string} value - e.g. "win32" or "darwin".
 * @returns {() => void} Restores the original descriptor.
 */
function setPlatform(value) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...original, value });
  return () => Object.defineProperty(process, 'platform', original);
}

/**
 * Jest-lifecycle wrapper around setPlatform: pins the platform for the
 * enclosing describe block and restores it afterwards.
 *
 * @param {string} value - e.g. "win32" or "darwin".
 */
function onPlatform(value) {
  let restore;
  beforeAll(() => {
    restore = setPlatform(value);
  });
  afterAll(() => {
    restore();
  });
}

/**
 * The `path` flavour matching the currently pinned platform. Tests build
 * their expected strings with this so that source and expectation agree on
 * separators regardless of the host OS.
 *
 * @returns {path.PlatformPath}
 */
function p() {
  return process.platform === 'win32' ? path.win32 : path.posix;
}

module.exports = { setPlatform, onPlatform, p };
