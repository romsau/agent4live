'use strict';

jest.mock('../../lom', () => ({
  lomSetTrackRouting: jest.fn(() => Promise.resolve()),
  lomGetTrackRouting: jest.fn(() => Promise.resolve('ROUTING_JSON')),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./routing');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it.each([
  ['get_track_input_routing', 'input'],
  ['get_track_output_routing', 'output'],
])('%s reads with side=%s', async (name, side) => {
  const text = await callHandlerText(byName(name).handler, { track: 0 });
  expect(lom.lomGetTrackRouting).toHaveBeenCalledWith(0, side);
  expect(text).toBe('ROUTING_JSON');
});

it.each([
  ['set_track_input_type', 'input_routing_type'],
  ['set_track_input_channel', 'input_routing_channel'],
  ['set_track_output_type', 'output_routing_type'],
])('%s writes %s', async (name, prop) => {
  await callHandlerText(byName(name).handler, { track: 0, identifier: 'ext-in' });
  expect(lom.lomSetTrackRouting).toHaveBeenCalledWith(0, prop, 'ext-in');
});
