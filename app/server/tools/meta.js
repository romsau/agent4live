'use strict';

const { defineTool } = require('./define');
const { GUIDE, GUIDE_URI } = require('../skill');

/**
 * Register meta tools — tools about the device itself rather than the LOM.
 * Currently a single entry point : `get_usage_guide`. Sized to scale if we
 * later add `get_changelog`, `get_version`, capability introspection, etc.
 *
 * @param {object} server
 */
function register(server) {
  defineTool(server, {
    name: 'get_usage_guide',
    description:
      'Return the agent4live usage guide as Markdown. **Read this once at the start of every agent4live session before issuing other agent4live tool calls** — it covers conventions (0-based indices, LOM path syntax, ~10–50 ms call latency), pitfalls that look like they work but silently fail (undo can kill the device, master rename ignored, drum pad SETs on empty pads ignored, etc.), and recipe patterns for common workflows (build a beat, mix bus, capture take into Arrangement, sound-design pass…). Equivalent to the MCP resource `' +
      GUIDE_URI +
      '` for clients that prefer tool calls over resource reads.',
    handler: () => Promise.resolve(GUIDE),
    successText: (_args, text) => String(text),
  });
}

module.exports = { register };
