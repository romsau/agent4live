'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./launch');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const clipPath = (t, s) => `live_set tracks ${t} clip_slots ${s} clip`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it.each([
  ['set_clip_launch_mode', 'launch_mode', 'mode', 2],
  ['set_clip_launch_quantization', 'launch_quantization', 'quantization', 5],
  ['set_clip_pitch_fine', 'pitch_fine', 'cents', 25],
])('%s writes %s as int', async (name, prop, argName, value) => {
  await callHandlerText(byName(name).handler, { track: 0, slot: 1, [argName]: value });
  expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), prop, value);
});

it('set_clip_muted encodes boolean → 1/0', async () => {
  await callHandlerText(byName('set_clip_muted').handler, { track: 0, slot: 1, on: true });
  expect(lom.lomSet).toHaveBeenLastCalledWith(clipPath(0, 1), 'muted', 1);
  await callHandlerText(byName('set_clip_muted').handler, { track: 0, slot: 1, on: false });
  expect(lom.lomSet).toHaveBeenLastCalledWith(clipPath(0, 1), 'muted', 0);
});
