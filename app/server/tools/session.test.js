'use strict';

jest.mock('../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
  lomSessionState: jest.fn(() => Promise.resolve('STATE_JSON')),
  lomGetScale: jest.fn(() => Promise.resolve('SCALE_JSON')),
  lomGetSelection: jest.fn(() => Promise.resolve('SEL_JSON')),
  lomSelectTrack: jest.fn(() => Promise.resolve()),
  lomSelectScene: jest.fn(() => Promise.resolve()),
  lomGetGrooves: jest.fn(() => Promise.resolve('GROOVES_JSON')),
  lomSetClipGroove: jest.fn(() => Promise.resolve()),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const lom = require('../lom');
const family = require('./session');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every tool has a non-empty description', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(20);
});

it('registers the expected tools', () => {
  expect(tools.map((t) => t.name).sort()).toEqual(
    [
      'get_session_state',
      'set_tempo',
      'set_signature',
      'set_clip_trigger_quantization',
      'set_midi_recording_quantization',
      're_enable_automation',
      'get_scale',
      'set_scale_mode',
      'set_scale_name',
      'set_root_note',
      'get_grooves',
      'set_groove',
      'set_global_groove_amount',
      'set_clip_groove',
      'get_selection',
      'select_track',
      'select_scene',
      'set_swing_amount',
    ].sort(),
  );
});

describe.each([
  ['get_session_state', 'lomSessionState', [], 'STATE_JSON'],
  ['get_scale', 'lomGetScale', [], 'SCALE_JSON'],
  ['get_grooves', 'lomGetGrooves', [], 'GROOVES_JSON'],
  ['get_selection', 'lomGetSelection', [], 'SEL_JSON'],
])('%s (read-only)', (name, helper, args, expected) => {
  it(`delegates to ${helper}`, async () => {
    const text = await callHandlerText(byName(name).handler, ...args);
    expect(lom[helper]).toHaveBeenCalled();
    expect(text).toBe(expected);
  });
});

describe('simple lomSet wrappers', () => {
  it('set_tempo writes live_set tempo', async () => {
    expect(await callHandlerText(byName('set_tempo').handler, { bpm: 140 })).toBe(
      'Tempo set to 140 BPM',
    );
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'tempo', 140);
  });

  it.each([
    ['set_clip_trigger_quantization', 'clip_trigger_quantization'],
    ['set_midi_recording_quantization', 'midi_recording_quantization'],
  ])('%s writes %s as int', async (name, prop) => {
    await callHandlerText(byName(name).handler, { value: 4 });
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', prop, 4);
  });

  it('set_scale_name writes live_set scale_name', async () => {
    await callHandlerText(byName('set_scale_name').handler, { name: 'Dorian' });
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'scale_name', 'Dorian');
  });

  it('set_root_note writes live_set root_note', async () => {
    await callHandlerText(byName('set_root_note').handler, { value: 5 });
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'root_note', 5);
  });

  it('set_global_groove_amount writes live_set groove_amount', async () => {
    await callHandlerText(byName('set_global_groove_amount').handler, { value: 0.5 });
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'groove_amount', 0.5);
  });

  it('set_swing_amount writes live_set swing_amount', async () => {
    await callHandlerText(byName('set_swing_amount').handler, { value: 0.7 });
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'swing_amount', 0.7);
  });
});

describe('boolean encoders', () => {
  it('set_scale_mode encodes on/off as 1/0', async () => {
    expect(await callHandlerText(byName('set_scale_mode').handler, { on: true })).toBe(
      'Scale mode on',
    );
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set', 'scale_mode', 1);
    expect(await callHandlerText(byName('set_scale_mode').handler, { on: false })).toBe(
      'Scale mode off',
    );
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set', 'scale_mode', 0);
  });
});

describe('set_signature', () => {
  it('issues two sequential lomSet calls (numerator, denominator)', async () => {
    const text = await callHandlerText(byName('set_signature').handler, {
      numerator: 6,
      denominator: 8,
    });
    expect(lom.lomSet).toHaveBeenNthCalledWith(1, 'live_set', 'signature_numerator', 6);
    expect(lom.lomSet).toHaveBeenNthCalledWith(2, 'live_set', 'signature_denominator', 8);
    expect(text).toBe('Time signature set to 6/8');
  });
});

describe('re_enable_automation', () => {
  it('calls live_set re_enable_automation', async () => {
    await callHandlerText(byName('re_enable_automation').handler);
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 're_enable_automation');
  });
});

describe('set_groove', () => {
  it('skips fields whose argument is undefined (only one field set)', async () => {
    await callHandlerText(byName('set_groove').handler, {
      groove_index: 2,
      timing_amount: 50,
    });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith('live_set groove_pool grooves 2', 'timing_amount', 50);
  });

  it('skips timing_amount and velocity_amount when only name is provided', async () => {
    // Hits the "false" branch of every optional check after name.
    await callHandlerText(byName('set_groove').handler, { groove_index: 0, name: 'Just Name' });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith('live_set groove_pool grooves 0', 'name', 'Just Name');
  });

  it('issues no sets when only groove_index is provided', async () => {
    await callHandlerText(byName('set_groove').handler, { groove_index: 0 });
    expect(lom.lomSet).not.toHaveBeenCalled();
  });

  it('issues a set per provided field, in declaration order', async () => {
    await callHandlerText(byName('set_groove').handler, {
      groove_index: 0,
      name: 'Funk',
      base: 1,
      quantization_amount: 50,
      random_amount: 10,
      timing_amount: 30,
      velocity_amount: 20,
    });
    expect(lom.lomSet).toHaveBeenCalledTimes(6);
    const calls = lom.lomSet.mock.calls.map(([, prop, value]) => [prop, value]);
    expect(calls).toEqual([
      ['name', 'Funk'],
      ['base', 1],
      ['quantization_amount', 50],
      ['random_amount', 10],
      ['timing_amount', 30],
      ['velocity_amount', 20],
    ]);
  });
});

describe('set_clip_groove', () => {
  it('forwards to lomSetClipGroove and recaps "set" or "cleared" by groove_index sign', async () => {
    expect(
      await callHandlerText(byName('set_clip_groove').handler, {
        track: 0,
        slot: 1,
        groove_index: 3,
      }),
    ).toBe('Clip groove set to 3');
    expect(lom.lomSetClipGroove).toHaveBeenLastCalledWith(0, 1, 3);

    expect(
      await callHandlerText(byName('set_clip_groove').handler, {
        track: 0,
        slot: 1,
        groove_index: -1,
      }),
    ).toBe('Clip groove cleared');
  });
});

describe('selection helpers', () => {
  it('select_track delegates with the index', async () => {
    expect(await callHandlerText(byName('select_track').handler, { track: 4 })).toBe(
      'Track 4 selected',
    );
    expect(lom.lomSelectTrack).toHaveBeenCalledWith(4);
  });

  it('select_scene delegates with the index', async () => {
    expect(await callHandlerText(byName('select_scene').handler, { scene: 2 })).toBe(
      'Scene 2 selected',
    );
    expect(lom.lomSelectScene).toHaveBeenCalledWith(2);
  });
});
