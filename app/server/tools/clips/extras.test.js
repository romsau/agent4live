'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
  lomClearClipEnvelope: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./extras');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const clipPath = (t, s) => `live_set tracks ${t} clip_slots ${s} clip`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('set_clip_legato encodes boolean → 1/0', async () => {
  await callHandlerText(byName('set_clip_legato').handler, { track: 0, slot: 1, on: true });
  expect(lom.lomSet).toHaveBeenLastCalledWith(clipPath(0, 1), 'legato', 1);
  await callHandlerText(byName('set_clip_legato').handler, { track: 0, slot: 1, on: false });
  expect(lom.lomSet).toHaveBeenLastCalledWith(clipPath(0, 1), 'legato', 0);
});

it.each([
  ['set_clip_velocity_amount', 'velocity_amount', 'amount', 0.5],
  ['set_clip_position', 'position', 'position', 8],
])('%s writes %s', async (name, prop, argName, value) => {
  await callHandlerText(byName(name).handler, { track: 0, slot: 1, [argName]: value });
  expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), prop, value);
});

describe('set_clip_signature', () => {
  it('writes numerator only', async () => {
    await callHandlerText(byName('set_clip_signature').handler, {
      track: 0,
      slot: 1,
      numerator: 5,
    });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), 'signature_numerator', 5);
  });

  it('writes denominator only', async () => {
    await callHandlerText(byName('set_clip_signature').handler, {
      track: 0,
      slot: 1,
      denominator: 8,
    });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), 'signature_denominator', 8);
  });

  it('writes both', async () => {
    await callHandlerText(byName('set_clip_signature').handler, {
      track: 0,
      slot: 1,
      numerator: 7,
      denominator: 8,
    });
    expect(lom.lomSet).toHaveBeenCalledTimes(2);
  });

  it('throws when both undefined', async () => {
    await expect(byName('set_clip_signature').handler({ track: 0, slot: 1 })).rejects.toThrow(
      /at least one of numerator/,
    );
  });
});

it('clear_clip_envelope delegates to lomClearClipEnvelope', async () => {
  await callHandlerText(byName('clear_clip_envelope').handler, {
    track: 0,
    slot: 1,
    device_index: 0,
    param_index: 5,
  });
  expect(lom.lomClearClipEnvelope).toHaveBeenCalledWith(0, 1, 0, 5);
});

it('clear_clip_envelopes calls clear_all_envelopes', async () => {
  await callHandlerText(byName('clear_clip_envelopes').handler, { track: 0, slot: 1 });
  expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'clear_all_envelopes');
});

it('duplicate_clip_loop calls duplicate_loop', async () => {
  await callHandlerText(byName('duplicate_clip_loop').handler, { track: 0, slot: 1 });
  expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'duplicate_loop');
});

it('move_warp_marker calls move_warp_marker with both times', async () => {
  await callHandlerText(byName('move_warp_marker').handler, {
    track: 0,
    slot: 1,
    beat_time: 4,
    beat_time_distance: 1,
  });
  expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'move_warp_marker', 4, 1);
});

describe('set_clip_loop', () => {
  it('off only writes looping=0', async () => {
    await callHandlerText(byName('set_clip_loop').handler, { track: 0, slot: 1, on: false });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), 'looping', 0);
  });

  it('on without region: just looping=1', async () => {
    expect(
      await callHandlerText(byName('set_clip_loop').handler, { track: 0, slot: 1, on: true }),
    ).toBe('Clip at track 0, slot 1 loop on');
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
  });

  it('on with start: writes loop_start', async () => {
    await callHandlerText(byName('set_clip_loop').handler, {
      track: 0,
      slot: 1,
      on: true,
      start: 0,
    });
    expect(lom.lomSet).toHaveBeenNthCalledWith(2, clipPath(0, 1), 'loop_start', 0);
  });

  it('on with start + end: writes both, recap shows range', async () => {
    expect(
      await callHandlerText(byName('set_clip_loop').handler, {
        track: 0,
        slot: 1,
        on: true,
        start: 0,
        end: 4,
      }),
    ).toBe('Clip at track 0, slot 1 loop on [0..4]');
  });

  it('on with end only: shows ? for missing start', async () => {
    expect(
      await callHandlerText(byName('set_clip_loop').handler, {
        track: 0,
        slot: 1,
        on: true,
        end: 4,
      }),
    ).toBe('Clip at track 0, slot 1 loop on [?..4]');
  });

  it('on with start only: shows ? for missing end', async () => {
    expect(
      await callHandlerText(byName('set_clip_loop').handler, {
        track: 0,
        slot: 1,
        on: true,
        start: 1,
      }),
    ).toBe('Clip at track 0, slot 1 loop on [1..?]');
  });
});
