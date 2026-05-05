'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
  lomGetTakeLanes: jest.fn(() => Promise.resolve('LANES')),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./take_lanes');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('create_take_lane calls create_take_lane on track path', async () => {
  await callHandlerText(byName('create_take_lane').handler, { track: 0 });
  expect(lom.lomCall).toHaveBeenCalledWith('live_set tracks 0', 'create_take_lane');
});

it('get_take_lanes delegates to lomGetTakeLanes', async () => {
  expect(await callHandlerText(byName('get_take_lanes').handler, { track: 0 })).toBe('LANES');
  expect(lom.lomGetTakeLanes).toHaveBeenCalledWith(0);
});

it('set_take_lane_name writes name on the lane path', async () => {
  await callHandlerText(byName('set_take_lane_name').handler, {
    track: 0,
    lane_index: 1,
    name: 'Take 2',
  });
  expect(lom.lomSet).toHaveBeenCalledWith('live_set tracks 0 take_lanes 1', 'name', 'Take 2');
});
