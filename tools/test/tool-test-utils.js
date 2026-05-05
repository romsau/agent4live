'use strict';

// Helpers for testing tools/<family>.js (and tools/<family>/<section>.js).
//
// Usage in a test file :
//   const { collectTools } = require('../../../tools/test/tool-test-utils');
//   const family = require('./raw');
//   const tools = collectTools(family.register);
//   tools.forEach(({ name, schema, handler, ... }) => { ... });

/**
 * Run a family's `register(server)` against a fake server that captures every
 * `server.tool(name, description, schema, handler)` call. Returns a flat array
 * of `{ name, description, schema, handler }` objects, in registration order.
 *
 * @param {(server: object) => void} register
 * @returns {Array<{ name: string, description: string, schema: object, handler: Function }>}
 */
function collectTools(register) {
  const captured = [];
  const fakeServer = {
    tool: (name, description, schema, handler) => {
      captured.push({ name, description, schema, handler });
    },
  };
  register(fakeServer);
  return captured;
}

/**
 * Call a captured handler and return its text payload (the string inside
 * `result.content[0].text`). The handler-wrapper from defineTool returns
 * `{ content: [{ type: 'text', text }] }`.
 *
 * @param {Function} handler
 * @param {object} [args]
 * @returns {Promise<string>}
 */
async function callHandlerText(handler, args = {}) {
  const result = await handler(args);
  return result.content[0].text;
}

module.exports = { collectTools, callHandlerText };
