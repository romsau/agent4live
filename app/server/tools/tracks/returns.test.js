'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./returns');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const returnPath = (i) => `live_set return_tracks ${i}`;
const returnMixer = (i) => `${returnPath(i)} mixer_device`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it.each([
  [
    'set_return_volume',
    (i) => `${returnMixer(i)} volume`,
    { return_index: 0, value: 0.85 },
    'value',
    0.85,
  ],
  [
    'set_return_panning',
    (i) => `${returnMixer(i)} panning`,
    { return_index: 0, value: 0.5 },
    'value',
    0.5,
  ],
])('%s writes mixer prop', async (name, pathFn, args, prop, value) => {
  await callHandlerText(byName(name).handler, args);
  expect(lom.lomSet).toHaveBeenCalledWith(pathFn(args.return_index), prop, value);
});

it('set_return_send writes sends N value', async () => {
  await callHandlerText(byName('set_return_send').handler, {
    return_index: 1,
    send_index: 0,
    value: 0.3,
  });
  expect(lom.lomSet).toHaveBeenCalledWith(`${returnMixer(1)} sends 0`, 'value', 0.3);
});

it.each([
  ['set_return_mute', 'mute', 'muted', 'unmuted'],
  ['set_return_solo', 'solo', 'soloed', 'un-soloed'],
])('%s encodes boolean → 1/0 and recaps', async (name, prop, onText, offText) => {
  expect(await callHandlerText(byName(name).handler, { return_index: 0, on: true })).toBe(
    `Return 0 ${onText}`,
  );
  expect(lom.lomSet).toHaveBeenLastCalledWith(returnPath(0), prop, 1);
  expect(await callHandlerText(byName(name).handler, { return_index: 0, on: false })).toBe(
    `Return 0 ${offText}`,
  );
});

it('set_return_name writes name on return path', async () => {
  await callHandlerText(byName('set_return_name').handler, { return_index: 0, name: 'Reverb' });
  expect(lom.lomSet).toHaveBeenCalledWith(returnPath(0), 'name', 'Reverb');
});

it('set_return_color writes color and recaps as hex', async () => {
  expect(
    await callHandlerText(byName('set_return_color').handler, { return_index: 0, color: 0xff0000 }),
  ).toBe('Return 0 color set to 0xFF0000');
});

it('delete_return_track calls live_set delete_return_track', async () => {
  await callHandlerText(byName('delete_return_track').handler, { return_index: 1 });
  expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'delete_return_track', 1);
});
