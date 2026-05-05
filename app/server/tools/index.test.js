'use strict';

describe('tools index', () => {
  it('exposes every family registrar with a register() function', () => {
    const tools = require('./index');
    const families = [
      'raw',
      'session',
      'transport',
      'tracks',
      'clips',
      'scenes',
      'arrangement',
      'application',
      'racks',
      'instruments',
      'browser',
    ];
    for (const name of families) {
      expect(tools[name]).toBeDefined();
      expect(typeof tools[name].register).toBe('function');
    }
  });
});
