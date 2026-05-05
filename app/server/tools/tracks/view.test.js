'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./view');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('set_track_collapsed encodes boolean → 1/0 on view path', async () => {
  expect(await callHandlerText(byName('set_track_collapsed').handler, { track: 0, on: true })).toBe(
    'Track 0 collapsed',
  );
  expect(lom.lomSet).toHaveBeenLastCalledWith('live_set tracks 0 view', 'is_collapsed', 1);
  expect(
    await callHandlerText(byName('set_track_collapsed').handler, { track: 0, on: false }),
  ).toBe('Track 0 expanded');
  expect(lom.lomSet).toHaveBeenLastCalledWith('live_set tracks 0 view', 'is_collapsed', 0);
});

it('select_track_instrument calls select_instrument on view path', async () => {
  await callHandlerText(byName('select_track_instrument').handler, { track: 0 });
  expect(lom.lomCall).toHaveBeenCalledWith('live_set tracks 0 view', 'select_instrument');
});
