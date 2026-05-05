'use strict';

jest.mock('../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
  lomGetCuePoints: jest.fn(() => Promise.resolve('CUES_JSON')),
  lomSetCuePointName: jest.fn(() => Promise.resolve()),
  lomJumpToCue: jest.fn(() => Promise.resolve()),
  lomDuplicateClipToArrangement: jest.fn(() => Promise.resolve()),
  lomDeleteArrangementClip: jest.fn(() => Promise.resolve()),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const lom = require('../lom');
const family = require('./arrangement');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('registers expected tools, every description non-empty', () => {
  expect(tools.map((t) => t.name).sort()).toEqual(
    [
      'set_song_time',
      'set_loop',
      'set_punch',
      'set_or_delete_cue',
      'jump_to_next_cue',
      'jump_to_prev_cue',
      'set_cue_point_name',
      'jump_to_cue',
      'get_cue_points',
      'set_arrangement_overdub',
      'back_to_arranger',
      'duplicate_clip_to_arrangement',
      'delete_arrangement_clip',
    ].sort(),
  );
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

describe('set_song_time', () => {
  it('writes current_song_time', async () => {
    expect(await callHandlerText(byName('set_song_time').handler, { beats: 16 })).toBe(
      'Song time set to beat 16',
    );
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'current_song_time', 16);
  });
});

describe('set_loop', () => {
  it('off only writes the loop flag (start/length skipped even if provided)', async () => {
    await callHandlerText(byName('set_loop').handler, { on: false, start: 0, length: 4 });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'loop', 0);
  });

  it('on without region: just the flag', async () => {
    expect(await callHandlerText(byName('set_loop').handler, { on: true })).toBe(
      'Arrangement loop on',
    );
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'loop', 1);
  });

  it('on with start: writes loop_start', async () => {
    await callHandlerText(byName('set_loop').handler, { on: true, start: 2 });
    expect(lom.lomSet).toHaveBeenNthCalledWith(2, 'live_set', 'loop_start', 2);
  });

  it('on with start + length: writes both', async () => {
    expect(
      await callHandlerText(byName('set_loop').handler, {
        on: true,
        start: 4,
        length: 8,
      }),
    ).toBe('Arrangement loop on [4 for 8]');
    expect(lom.lomSet).toHaveBeenCalledTimes(3);
  });

  it('successText handles missing length but present start', async () => {
    expect(await callHandlerText(byName('set_loop').handler, { on: true, start: 4 })).toBe(
      'Arrangement loop on [4 for ?]',
    );
  });

  it('successText handles missing start but present length', async () => {
    expect(await callHandlerText(byName('set_loop').handler, { on: true, length: 8 })).toBe(
      'Arrangement loop on [? for 8]',
    );
  });
});

describe('set_punch', () => {
  it('writes punch_in only when provided', async () => {
    await callHandlerText(byName('set_punch').handler, { punch_in: true });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'punch_in', 1);
  });

  it('writes punch_out only when provided', async () => {
    await callHandlerText(byName('set_punch').handler, { punch_out: false });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'punch_out', 0);
  });

  it('writes both when both provided', async () => {
    await callHandlerText(byName('set_punch').handler, { punch_in: true, punch_out: false });
    expect(lom.lomSet).toHaveBeenCalledTimes(2);
  });

  it('encodes false → 0 and true → 1 for both fields', async () => {
    await callHandlerText(byName('set_punch').handler, { punch_in: false, punch_out: true });
    expect(lom.lomSet).toHaveBeenNthCalledWith(1, 'live_set', 'punch_in', 0);
    expect(lom.lomSet).toHaveBeenNthCalledWith(2, 'live_set', 'punch_out', 1);
  });

  it('throws when neither flag is provided', async () => {
    await expect(byName('set_punch').handler({})).rejects.toThrow(/at least one of punch_in/);
  });
});

describe('cue navigation no-arg tools', () => {
  it.each([
    ['set_or_delete_cue', 'live_set', 'set_or_delete_cue'],
    ['jump_to_next_cue', 'live_set', 'jump_to_next_cue'],
    ['jump_to_prev_cue', 'live_set', 'jump_to_prev_cue'],
  ])('%s calls lomCall', async (name, path, method) => {
    await callHandlerText(byName(name).handler);
    expect(lom.lomCall).toHaveBeenCalledWith(path, method);
  });
});

describe('cue point getters / setters', () => {
  it('set_cue_point_name delegates to lomSetCuePointName', async () => {
    expect(
      await callHandlerText(byName('set_cue_point_name').handler, { cue_index: 1, name: 'Verse' }),
    ).toBe('Cue point 1 renamed to "Verse"');
    expect(lom.lomSetCuePointName).toHaveBeenCalledWith(1, 'Verse');
  });

  it('jump_to_cue delegates to lomJumpToCue', async () => {
    await callHandlerText(byName('jump_to_cue').handler, { cue_index: 2 });
    expect(lom.lomJumpToCue).toHaveBeenCalledWith(2);
  });

  it('get_cue_points returns the JSON', async () => {
    expect(await callHandlerText(byName('get_cue_points').handler)).toBe('CUES_JSON');
    expect(lom.lomGetCuePoints).toHaveBeenCalled();
  });
});

describe('overdub + back_to_arranger', () => {
  it('set_arrangement_overdub encodes boolean → 1/0', async () => {
    expect(await callHandlerText(byName('set_arrangement_overdub').handler, { on: true })).toBe(
      'Arrangement overdub on',
    );
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set', 'arrangement_overdub', 1);
    expect(await callHandlerText(byName('set_arrangement_overdub').handler, { on: false })).toBe(
      'Arrangement overdub off',
    );
  });

  it('back_to_arranger writes 0 to live_set back_to_arranger', async () => {
    await callHandlerText(byName('back_to_arranger').handler);
    expect(lom.lomSet).toHaveBeenCalledWith('live_set', 'back_to_arranger', 0);
  });
});

describe('arrangement clip lifecycle', () => {
  it('duplicate_clip_to_arrangement delegates to lomDuplicateClipToArrangement', async () => {
    await callHandlerText(byName('duplicate_clip_to_arrangement').handler, {
      track: 0,
      slot: 1,
      destination_time: 16,
    });
    expect(lom.lomDuplicateClipToArrangement).toHaveBeenCalledWith(0, 1, 16);
  });

  it('delete_arrangement_clip delegates to lomDeleteArrangementClip', async () => {
    await callHandlerText(byName('delete_arrangement_clip').handler, {
      track: 0,
      arrangement_clip_idx: 0,
    });
    expect(lom.lomDeleteArrangementClip).toHaveBeenCalledWith(0, 0);
  });
});
