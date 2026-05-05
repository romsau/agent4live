'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
  lomGetClipAudioInfo: jest.fn(() => Promise.resolve('AUDIO_INFO')),
  lomGetWarpMarkers: jest.fn(() => Promise.resolve('WARP_MARKERS')),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./audio');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const clipPath = (t, s) => `live_set tracks ${t} clip_slots ${s} clip`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('get_clip_audio_info delegates and returns JSON', async () => {
  const text = await callHandlerText(byName('get_clip_audio_info').handler, { track: 0, slot: 1 });
  expect(lom.lomGetClipAudioInfo).toHaveBeenCalledWith(0, 1);
  expect(text).toBe('AUDIO_INFO');
});

it.each([
  ['set_clip_warp', 'warping'],
  ['set_clip_ram_mode', 'ram_mode'],
])('%s encodes boolean → 1/0', async (name, prop) => {
  await callHandlerText(byName(name).handler, { track: 0, slot: 1, on: true });
  expect(lom.lomSet).toHaveBeenLastCalledWith(clipPath(0, 1), prop, 1);
  await callHandlerText(byName(name).handler, { track: 0, slot: 1, on: false });
  expect(lom.lomSet).toHaveBeenLastCalledWith(clipPath(0, 1), prop, 0);
});

it.each([
  ['set_clip_warp_mode', 'warp_mode', 'mode', 4],
  ['set_clip_gain', 'gain', 'value', 0.7],
])('%s writes %s', async (name, prop, argName, value) => {
  await callHandlerText(byName(name).handler, { track: 0, slot: 1, [argName]: value });
  expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), prop, value);
});

describe('set_clip_pitch', () => {
  it('writes pitch_coarse only', async () => {
    await callHandlerText(byName('set_clip_pitch').handler, { track: 0, slot: 1, coarse: -2 });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), 'pitch_coarse', -2);
  });

  it('writes pitch_fine only', async () => {
    await callHandlerText(byName('set_clip_pitch').handler, { track: 0, slot: 1, fine: 25 });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), 'pitch_fine', 25);
  });

  it('writes both when both provided', async () => {
    await callHandlerText(byName('set_clip_pitch').handler, {
      track: 0,
      slot: 1,
      coarse: -2,
      fine: 25,
    });
    expect(lom.lomSet).toHaveBeenCalledTimes(2);
  });

  it('throws when both undefined', async () => {
    await expect(byName('set_clip_pitch').handler({ track: 0, slot: 1 })).rejects.toThrow(
      /at least one of coarse/,
    );
  });
});

describe('set_clip_markers', () => {
  it('writes start only', async () => {
    await callHandlerText(byName('set_clip_markers').handler, { track: 0, slot: 1, start: 0 });
    expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), 'start_marker', 0);
  });

  it('writes end only', async () => {
    await callHandlerText(byName('set_clip_markers').handler, { track: 0, slot: 1, end: 8 });
    expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), 'end_marker', 8);
  });

  it('writes start before end when both provided', async () => {
    await callHandlerText(byName('set_clip_markers').handler, {
      track: 0,
      slot: 1,
      start: 0,
      end: 8,
    });
    expect(lom.lomSet).toHaveBeenNthCalledWith(1, clipPath(0, 1), 'start_marker', 0);
    expect(lom.lomSet).toHaveBeenNthCalledWith(2, clipPath(0, 1), 'end_marker', 8);
  });

  it('throws when both undefined', async () => {
    await expect(byName('set_clip_markers').handler({ track: 0, slot: 1 })).rejects.toThrow(
      /at least one of start/,
    );
  });
});

it('crop_clip calls crop on clip path', async () => {
  await callHandlerText(byName('crop_clip').handler, { track: 0, slot: 1 });
  expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'crop');
});

it('remove_warp_marker calls remove_warp_marker with beat_time', async () => {
  await callHandlerText(byName('remove_warp_marker').handler, { track: 0, slot: 1, beat_time: 4 });
  expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'remove_warp_marker', 4);
});

it('get_warp_markers delegates to lomGetWarpMarkers', async () => {
  const text = await callHandlerText(byName('get_warp_markers').handler, { track: 0, slot: 1 });
  expect(lom.lomGetWarpMarkers).toHaveBeenCalledWith(0, 1);
  expect(text).toBe('WARP_MARKERS');
});
