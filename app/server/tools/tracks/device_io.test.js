'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
  lomGetDeviceIoRoutings: jest.fn(() => Promise.resolve('IO_ROUTINGS')),
  lomSetDeviceIoRoutingType: jest.fn(() => Promise.resolve()),
  lomSetDeviceIoRoutingChannel: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./device_io');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const trackPath = (t) => `live_set tracks ${t}`;
const devicePath = (t, d) => `${trackPath(t)} devices ${d}`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('get_device_io_routings delegates to lomGetDeviceIoRoutings', async () => {
  expect(
    await callHandlerText(byName('get_device_io_routings').handler, { track: 0, device_index: 0 }),
  ).toBe('IO_ROUTINGS');
  expect(lom.lomGetDeviceIoRoutings).toHaveBeenCalledWith(0, 0);
});

it('set_device_io_routing_type forwards all 5 args', async () => {
  await callHandlerText(byName('set_device_io_routing_type').handler, {
    track: 0,
    device_index: 0,
    io_type: 'audio_in',
    io_index: 0,
    identifier: 'ext-1',
  });
  expect(lom.lomSetDeviceIoRoutingType).toHaveBeenCalledWith(0, 0, 'audio_in', 0, 'ext-1');
});

it('set_device_io_routing_channel forwards all 5 args', async () => {
  await callHandlerText(byName('set_device_io_routing_channel').handler, {
    track: 0,
    device_index: 0,
    io_type: 'midi_in',
    io_index: 0,
    identifier: 'L',
  });
  expect(lom.lomSetDeviceIoRoutingChannel).toHaveBeenCalledWith(0, 0, 'midi_in', 0, 'L');
});

it('save_device_compare_ab calls save_preset_to_compare_ab_slot', async () => {
  await callHandlerText(byName('save_device_compare_ab').handler, { track: 0, device_index: 1 });
  expect(lom.lomCall).toHaveBeenCalledWith(devicePath(0, 1), 'save_preset_to_compare_ab_slot');
});

it('re_enable_param_automation calls re_enable_automation on the param path', async () => {
  await callHandlerText(byName('re_enable_param_automation').handler, {
    track: 0,
    device_index: 1,
    param_index: 5,
  });
  expect(lom.lomCall).toHaveBeenCalledWith(
    `${devicePath(0, 1)} parameters 5`,
    're_enable_automation',
  );
});

it('create_take_lane_midi_clip calls create_midi_clip on take lane path', async () => {
  await callHandlerText(byName('create_take_lane_midi_clip').handler, {
    track: 0,
    take_lane_index: 1,
    start_time: 0,
    length: 4,
  });
  expect(lom.lomCall).toHaveBeenCalledWith(
    `${trackPath(0)} take_lanes 1`,
    'create_midi_clip',
    0,
    4,
  );
});

it('create_take_lane_audio_clip calls create_audio_clip on take lane path', async () => {
  await callHandlerText(byName('create_take_lane_audio_clip').handler, {
    track: 0,
    take_lane_index: 1,
    file_path: '/tmp/sample.wav',
    start_time: 0,
  });
  expect(lom.lomCall).toHaveBeenCalledWith(
    `${trackPath(0)} take_lanes 1`,
    'create_audio_clip',
    '/tmp/sample.wav',
    0,
  );
});

it('set_device_active writes parameters[0] value', async () => {
  await callHandlerText(byName('set_device_active').handler, {
    track: 0,
    device_index: 1,
    on: true,
  });
  expect(lom.lomSet).toHaveBeenLastCalledWith(`${devicePath(0, 1)} parameters 0`, 'value', 1);
  await callHandlerText(byName('set_device_active').handler, {
    track: 0,
    device_index: 1,
    on: false,
  });
  expect(lom.lomSet).toHaveBeenLastCalledWith(`${devicePath(0, 1)} parameters 0`, 'value', 0);
});

describe('insert_device', () => {
  it('without target_index: appends', async () => {
    await callHandlerText(byName('insert_device').handler, { track: 0, device_name: 'Reverb' });
    expect(lom.lomCall).toHaveBeenCalledWith(trackPath(0), 'insert_device', 'Reverb');
  });

  it('with target_index: passes position', async () => {
    expect(
      await callHandlerText(byName('insert_device').handler, {
        track: 0,
        device_name: 'EQ Eight',
        target_index: 1,
      }),
    ).toBe('Inserted "EQ Eight" on track 0 at 1');
    expect(lom.lomCall).toHaveBeenCalledWith(trackPath(0), 'insert_device', 'EQ Eight', 1);
  });
});

it('delete_device calls delete_device with index', async () => {
  await callHandlerText(byName('delete_device').handler, { track: 0, device_index: 2 });
  expect(lom.lomCall).toHaveBeenCalledWith(trackPath(0), 'delete_device', 2);
});
