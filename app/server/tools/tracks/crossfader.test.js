'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./crossfader');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('set_crossfader writes master crossfader value', async () => {
  await callHandlerText(byName('set_crossfader').handler, { value: 0.5 });
  expect(lom.lomSet).toHaveBeenCalledWith(
    'live_set master_track mixer_device crossfader',
    'value',
    0.5,
  );
});

it('set_track_crossfade_assign writes mixer crossfade_assign on the track', async () => {
  await callHandlerText(byName('set_track_crossfade_assign').handler, { track: 0, assign: 2 });
  expect(lom.lomSet).toHaveBeenCalledWith('live_set tracks 0 mixer_device', 'crossfade_assign', 2);
});

it('set_return_crossfade_assign writes the return mixer crossfade_assign', async () => {
  await callHandlerText(byName('set_return_crossfade_assign').handler, {
    return_index: 1,
    assign: 0,
  });
  expect(lom.lomSet).toHaveBeenCalledWith(
    'live_set return_tracks 1 mixer_device',
    'crossfade_assign',
    0,
  );
});
