'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./master');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const masterMixer = 'live_set master_track mixer_device';

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it.each([
  ['set_master_volume', `${masterMixer} volume`, 0.85],
  ['set_master_panning', `${masterMixer} panning`, 0],
  ['set_master_cue_volume', `${masterMixer} cue_volume`, 0.7],
])('%s writes the right path', async (name, path, value) => {
  await callHandlerText(byName(name).handler, { value });
  expect(lom.lomSet).toHaveBeenCalledWith(path, 'value', value);
});

it('set_master_color writes color on master_track and recaps in zero-padded hex', async () => {
  expect(await callHandlerText(byName('set_master_color').handler, { color: 0xff8800 })).toBe(
    'Master color set to 0xFF8800',
  );
  expect(lom.lomSet).toHaveBeenCalledWith('live_set master_track', 'color', 0xff8800);
});
