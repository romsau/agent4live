'use strict';

const { uiLog } = require('../ui/state');

/**
 * Wraps `server.tool(...)` with the standard try/catch + uiLog pattern used
 * by every MCP tool in this project. Replaces ~10 lines of boilerplate per
 * tool with a single config object. Handler errors are logged then re-thrown
 * so the MCP transport surfaces them as tool errors.
 *
 * @param {object} server - MCP server instance with .tool(name, desc, schema, handler)
 * @param {object} config
 * @param {string} config.name - tool name (matches the agent-facing identifier)
 * @param {string} config.description - tool description (shown to agents)
 * @param {object} [config.schema] - Zod schema map (default {})
 * @param {(args: object) => Promise<unknown>} config.handler - async work, receives validated args
 * @param {string | ((args: object, result: unknown) => string)} config.successText
 *   Static string or function returning the message in the success response
 * @param {(args: object) => string} [config.label]
 *   Custom UI log label. Default: `name(arg1,arg2,...)` from args values
 */
function defineTool(server, config) {
  const { name, description, schema = {}, handler, successText, label } = config;

  const makeLabel = label ?? ((args) => formatDefaultLabel(name, args));
  const makeText = typeof successText === 'function' ? successText : () => successText;

  server.tool(name, description, schema, async (args = {}) => {
    const tag = makeLabel(args);
    try {
      const result = await handler(args);
      uiLog(tag, false);
      return { content: [{ type: 'text', text: makeText(args, result) }] };
    } catch (err) {
      uiLog(tag, true);
      throw err;
    }
  });
}

/**
 * Default log label format: `name` for no-arg tools, `name(v1,v2,...)` otherwise.
 * Undefined values render as `-` (matches the `arg ?? '-'` idiom used by the
 * pre-helper boilerplate).
 *
 * @param {string} name
 * @param {object} args
 * @returns {string}
 */
function formatDefaultLabel(name, args) {
  const values = Object.values(args);
  if (values.length === 0) return name;
  return `${name}(${values.map((value) => (value === undefined ? '-' : value)).join(',')})`;
}

module.exports = { defineTool };
