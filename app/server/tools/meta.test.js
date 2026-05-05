'use strict';

jest.mock('../skill', () => ({
  GUIDE: '# fake guide\n\nbody content with `code` and **bold**.',
  GUIDE_URI: 'agent4live://guide',
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const family = require('./meta');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

it('registers the 1 meta tool', () => {
  expect(tools.map((t) => t.name)).toEqual(['get_usage_guide']);
});

it("get_usage_guide's description points the agent at it as a session-start read + mentions the resource URI", () => {
  const desc = byName('get_usage_guide').description;
  // The strong signal that triggers spontaneous reading at tools/list time.
  expect(desc).toMatch(/Read this once/i);
  // The MCP resource URI for clients that prefer resource reads.
  expect(desc).toContain('agent4live://guide');
  expect(desc.length).toBeGreaterThan(50);
});

it('get_usage_guide returns the bundled markdown verbatim', async () => {
  const text = await callHandlerText(byName('get_usage_guide').handler);
  expect(text).toBe('# fake guide\n\nbody content with `code` and **bold**.');
});
