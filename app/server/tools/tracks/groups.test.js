'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomGetTrackGroupInfo: jest.fn(() => Promise.resolve('GROUP_INFO')),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./groups');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('get_track_group_info delegates to lomGetTrackGroupInfo', async () => {
  expect(await callHandlerText(byName('get_track_group_info').handler, { track: 0 })).toBe(
    'GROUP_INFO',
  );
  expect(lom.lomGetTrackGroupInfo).toHaveBeenCalledWith(0);
});

it('set_track_fold encodes boolean → 1/0 on track path', async () => {
  expect(await callHandlerText(byName('set_track_fold').handler, { track: 0, on: true })).toBe(
    'Track 0 folded',
  );
  expect(lom.lomSet).toHaveBeenLastCalledWith('live_set tracks 0', 'fold_state', 1);
  await callHandlerText(byName('set_track_fold').handler, { track: 0, on: false });
  expect(lom.lomSet).toHaveBeenLastCalledWith('live_set tracks 0', 'fold_state', 0);
});
