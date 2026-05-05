'use strict';

jest.mock('../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const lom = require('../lom');
const family = require('./instruments');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const devicePath = (t, d) => `live_set tracks ${t} devices ${d}`;
const samplePath = (t, d) => `${devicePath(t, d)} sample`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every tool has a non-empty description', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

describe.each([
  ['set_simpler_playback_mode', 'playback_mode', 2],
  ['set_simpler_slicing_playback_mode', 'slicing_playback_mode', 1],
  ['set_simpler_voices', 'voices', 8],
  ['set_looper_record_length_index', 'record_length_index', 3],
])('%s — int → device prop', (name, prop, value) => {
  it(`writes ${prop}`, async () => {
    const argName = {
      set_simpler_playback_mode: 'mode',
      set_simpler_slicing_playback_mode: 'mode',
      set_simpler_voices: 'voices',
      set_looper_record_length_index: 'index',
    }[name];
    await callHandlerText(byName(name).handler, { track: 0, device_index: 1, [argName]: value });
    expect(lom.lomSet).toHaveBeenCalledWith(devicePath(0, 1), prop, value);
  });
});

describe.each([
  ['set_simpler_retrigger', 'retrigger'],
  ['set_simpler_multi_sample_mode', 'multi_sample_mode'],
  ['set_looper_overdub_after_record', 'overdub_after_record'],
])('%s — boolean → 1/0 on device', (name, prop) => {
  it(`writes ${prop} as 1 then 0`, async () => {
    await callHandlerText(byName(name).handler, { track: 0, device_index: 1, on: true });
    expect(lom.lomSet).toHaveBeenLastCalledWith(devicePath(0, 1), prop, 1);
    await callHandlerText(byName(name).handler, { track: 0, device_index: 1, on: false });
    expect(lom.lomSet).toHaveBeenLastCalledWith(devicePath(0, 1), prop, 0);
  });
});

describe.each([
  ['set_sample_slicing_sensitivity', 'slicing_sensitivity', 0.7, 'sensitivity'],
  ['set_sample_slicing_beat_division', 'slicing_beat_division', 8, 'division'],
  ['set_sample_slicing_region_count', 'slicing_region_count', 16, 'count'],
])('%s — sample prop', (name, prop, value, argName) => {
  it(`writes ${prop} on samplePath`, async () => {
    await callHandlerText(byName(name).handler, { track: 0, device_index: 1, [argName]: value });
    expect(lom.lomSet).toHaveBeenCalledWith(samplePath(0, 1), prop, value);
  });
});

describe('set_sample_mode_params', () => {
  it('writes nothing when no fields provided', async () => {
    await callHandlerText(byName('set_sample_mode_params').handler, { track: 0, device_index: 1 });
    expect(lom.lomSet).not.toHaveBeenCalled();
  });

  it('writes only the fields that are defined, in declaration order', async () => {
    await callHandlerText(byName('set_sample_mode_params').handler, {
      track: 0,
      device_index: 1,
      beats_granulation_resolution: 3,
      texture_grain_size: 0.5,
    });
    expect(lom.lomSet).toHaveBeenCalledTimes(2);
    const calls = lom.lomSet.mock.calls.map(([, p, v]) => [p, v]);
    expect(calls).toEqual([
      ['beats_granulation_resolution', 3],
      ['texture_grain_size', 0.5],
    ]);
  });

  it('writes every field when all provided', async () => {
    await callHandlerText(byName('set_sample_mode_params').handler, {
      track: 0,
      device_index: 1,
      beats_granulation_resolution: 3,
      beats_transient_envelope: 50,
      beats_transient_loop_mode: 1,
      complex_pro_envelope: 0.5,
      complex_pro_formants: 0.5,
      texture_flux: 0.7,
      texture_grain_size: 0.5,
      tones_grain_size: 0.5,
    });
    expect(lom.lomSet).toHaveBeenCalledTimes(8);
  });
});

describe('sample slice methods', () => {
  it('insert_sample_slice → insert_slice on samplePath', async () => {
    await callHandlerText(byName('insert_sample_slice').handler, {
      track: 0,
      device_index: 1,
      slice_time: 1024,
    });
    expect(lom.lomCall).toHaveBeenCalledWith(samplePath(0, 1), 'insert_slice', 1024);
  });

  it('move_sample_slice → move_slice with both times', async () => {
    await callHandlerText(byName('move_sample_slice').handler, {
      track: 0,
      device_index: 1,
      source_time: 1024,
      dest_time: 2048,
    });
    expect(lom.lomCall).toHaveBeenCalledWith(samplePath(0, 1), 'move_slice', 1024, 2048);
  });

  it('remove_sample_slice → remove_slice with the time', async () => {
    await callHandlerText(byName('remove_sample_slice').handler, {
      track: 0,
      device_index: 1,
      slice_time: 1024,
    });
    expect(lom.lomCall).toHaveBeenCalledWith(samplePath(0, 1), 'remove_slice', 1024);
  });

  it('clear_sample_slices → clear_slices', async () => {
    await callHandlerText(byName('clear_sample_slices').handler, { track: 0, device_index: 1 });
    expect(lom.lomCall).toHaveBeenCalledWith(samplePath(0, 1), 'clear_slices');
  });

  it('reset_sample_slices → reset_slices', async () => {
    await callHandlerText(byName('reset_sample_slices').handler, { track: 0, device_index: 1 });
    expect(lom.lomCall).toHaveBeenCalledWith(samplePath(0, 1), 'reset_slices');
  });
});
