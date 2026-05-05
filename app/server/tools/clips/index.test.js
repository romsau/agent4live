'use strict';

// The clips/index.js orchestrator just chains each sub-module's register().
// Mocking the sub-modules and asserting they're each called once gives 100%
// without re-testing each individual tool (those have their own test files).

jest.mock('./creation', () => ({ register: jest.fn() }));
jest.mock('./notes', () => ({ register: jest.fn() }));
jest.mock('./audio', () => ({ register: jest.fn() }));
jest.mock('./launch', () => ({ register: jest.fn() }));
jest.mock('./navigation', () => ({ register: jest.fn() }));
jest.mock('./extras', () => ({ register: jest.fn() }));

const family = require('./index');
const subs = ['./creation', './notes', './audio', './launch', './navigation', './extras'].map((m) =>
  require(m),
);

it('register() chains every sub-module register with the same server arg', () => {
  const server = { tool: jest.fn() };
  family.register(server);
  for (const sub of subs) {
    expect(sub.register).toHaveBeenCalledTimes(1);
    expect(sub.register).toHaveBeenCalledWith(server);
  }
});
