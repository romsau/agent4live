'use strict';

// Setup file loaded by Jest BEFORE each test file (cf. setupFiles in
// jest.config.js). Installs no-op stubs for the Max [js] runtime globals
// that app/lom_router/**/*.js relies on. Tests can override any of these
// per-test (e.g. `global.LiveAPI = jest.fn().mockReturnValue({...})`) before
// requiring the module under test.

// LiveAPI : constructed via `new LiveAPI(handler, path)` or `new LiveAPI()`.
// Default returns a barebones object that throws on get/set/call to force
// per-test setup ; otherwise tests would silently get `undefined` from
// uninitialised props and pass without verifying behavior.
global.LiveAPI = function LiveAPI(_handler, _path) {
  return {
    id: 0,
    path: '',
    property: '',
    get: () => {
      throw new Error('LiveAPI.get not stubbed in this test');
    },
    set: () => {
      throw new Error('LiveAPI.set not stubbed in this test');
    },
    call: () => {
      throw new Error('LiveAPI.call not stubbed in this test');
    },
    getcount: () => 0,
  };
};

// Dict : `new Dict()` then `.parse(json)` then `.stringify()`.
global.Dict = function Dict(name) {
  const state = { name: name || 'dict_' + Math.random() };
  return {
    name: state.name,
    parse: (json) => {
      state.json = json;
    },
    stringify: () => state.json || '{}',
  };
};

// Task : Max scheduler. `new Task(fn).schedule(delay)` / `.cancel()`.
global.Task = function Task(fn) {
  return {
    schedule: () => fn(),
    cancel: () => {},
  };
};

// outlet : send a message out of the [js] object's outlet at index. Backed
// by jest.fn() so tests can assert on the calls (e.g.
// `expect(outlet).toHaveBeenCalledWith(0, 'lom_response', id, 'ok', val)`).
global.outlet = jest.fn();

// post / error : Max console logging. No-op.
global.post = () => {};
global.error = () => {};

// messnamed : send to a named [receive] object. No-op.
global.messnamed = () => {};

// inlets / outlets : count declarations. lom_router top-level sets these.
global.inlets = 1;
global.outlets = 1;

// Propagate 00_helpers exports as globals so per-domain files (which use
// `_handle`, `_unwrap`, `_clipPath` etc. as Max-runtime globals post-concat)
// can be required individually under Jest. Loading 00_helpers here means it
// runs before any test file's require, with the Max stubs already in place.
const path = require('node:path');
const helpers = require(path.join(__dirname, '..', '..', 'app', 'lom_router', '00_helpers'));
for (const [name, fn] of Object.entries(helpers)) global[name] = fn;
