'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomSetTrackRouting: jest.fn(() => Promise.resolve()),
  lomGetTrackDevices: jest.fn(() => Promise.resolve('DEVICES')),
  lomGetDeviceParams: jest.fn(() => Promise.resolve('PARAMS')),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./devices_params');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const devicePath = (t, d) => `live_set tracks ${t} devices ${d}`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('get_track_devices delegates to lomGetTrackDevices', async () => {
  expect(await callHandlerText(byName('get_track_devices').handler, { track: 0 })).toBe('DEVICES');
  expect(lom.lomGetTrackDevices).toHaveBeenCalledWith(0);
});

it('get_device_params delegates to lomGetDeviceParams', async () => {
  expect(
    await callHandlerText(byName('get_device_params').handler, { track: 0, device_index: 1 }),
  ).toBe('PARAMS');
  expect(lom.lomGetDeviceParams).toHaveBeenCalledWith(0, 1);
});

it('set_device_param writes value at parameter path', async () => {
  await callHandlerText(byName('set_device_param').handler, {
    track: 0,
    device_index: 1,
    param_index: 5,
    value: 0.5,
  });
  expect(lom.lomSet).toHaveBeenCalledWith(`${devicePath(0, 1)} parameters 5`, 'value', 0.5);
});

it('set_track_output_channel writes routing_channel via lomSetTrackRouting', async () => {
  await callHandlerText(byName('set_track_output_channel').handler, {
    track: 0,
    identifier: 'L',
  });
  expect(lom.lomSetTrackRouting).toHaveBeenCalledWith(0, 'output_routing_channel', 'L');
});
