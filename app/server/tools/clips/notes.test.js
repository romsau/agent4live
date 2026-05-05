'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
  lomAddClip: jest.fn(() => Promise.resolve()),
  lomGetClipNotes: jest.fn(() => Promise.resolve('CLIP_NOTES')),
  lomReplaceClipNotes: jest.fn(() => Promise.resolve()),
  lomApplyNoteModifications: jest.fn(() => Promise.resolve()),
  lomGetAllNotes: jest.fn(() => Promise.resolve('ALL_NOTES')),
  lomGetSelectedNotes: jest.fn(() => Promise.resolve('SEL_NOTES')),
  lomGetNotesById: jest.fn(() => Promise.resolve('BY_ID_NOTES')),
  lomAddWarpMarker: jest.fn(() => Promise.resolve()),
  lomRemoveNotesById: jest.fn(() => Promise.resolve()),
  lomDuplicateNotesById: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./notes');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const slotPath = (t, s) => `live_set tracks ${t} clip_slots ${s}`;
const clipPath = (t, s) => `${slotPath(t, s)} clip`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('registers ~19 tools, every description non-empty', () => {
  expect(tools.length).toBeGreaterThanOrEqual(19);
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

describe('removal / region helpers', () => {
  it('remove_notes_by_id JSONifies note_ids', async () => {
    await callHandlerText(byName('remove_notes_by_id').handler, {
      track: 0,
      slot: 1,
      note_ids: [42, 43],
    });
    expect(lom.lomRemoveNotesById).toHaveBeenCalledWith(0, 1, '[42,43]');
  });

  it('remove_notes_region calls remove_notes_extended with region args', async () => {
    await callHandlerText(byName('remove_notes_region').handler, {
      track: 0,
      slot: 1,
      from_pitch: 36,
      pitch_span: 12,
      from_time: 0,
      time_span: 4,
    });
    expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'remove_notes_extended', 36, 12, 0, 4);
  });

  it('duplicate_notes_by_id includes only provided optional fields', async () => {
    await callHandlerText(byName('duplicate_notes_by_id').handler, {
      track: 0,
      slot: 1,
      note_ids: [1],
    });
    expect(lom.lomDuplicateNotesById).toHaveBeenLastCalledWith(0, 1, '{"note_ids":[1]}');

    await callHandlerText(byName('duplicate_notes_by_id').handler, {
      track: 0,
      slot: 1,
      note_ids: [1],
      destination_time: 8,
    });
    expect(lom.lomDuplicateNotesById).toHaveBeenLastCalledWith(
      0,
      1,
      '{"note_ids":[1],"destination_time":8}',
    );

    await callHandlerText(byName('duplicate_notes_by_id').handler, {
      track: 0,
      slot: 1,
      note_ids: [1],
      destination_time: 8,
      transposition_amount: 2,
    });
    expect(lom.lomDuplicateNotesById).toHaveBeenLastCalledWith(
      0,
      1,
      '{"note_ids":[1],"destination_time":8,"transposition_amount":2}',
    );

    // transposition only, no destination_time — covers the other branch
    await callHandlerText(byName('duplicate_notes_by_id').handler, {
      track: 0,
      slot: 1,
      note_ids: [1],
      transposition_amount: 12,
    });
    expect(lom.lomDuplicateNotesById).toHaveBeenLastCalledWith(
      0,
      1,
      '{"note_ids":[1],"transposition_amount":12}',
    );
  });

  it('duplicate_region forwards region/dest/pitch/transposition', async () => {
    await callHandlerText(byName('duplicate_region').handler, {
      track: 0,
      slot: 1,
      region_start: 0,
      region_length: 4,
      destination_time: 16,
      pitch: -1,
      transposition_amount: 0,
    });
    expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'duplicate_region', 0, 4, 16, -1, 0);
  });
});

describe('add_clip', () => {
  it('serializes notes and forwards', async () => {
    const text = await callHandlerText(byName('add_clip').handler, {
      track_index: 0,
      clip_slot_index: 1,
      length: 4,
      notes: [{ pitch: 60, time: 0, duration: 1, velocity: 100 }],
    });
    expect(lom.lomAddClip).toHaveBeenCalledWith(0, 1, 4, expect.stringMatching(/"pitch":60/));
    expect(text).toContain('1 note(s)');
  });
});

describe('fire_clip_with_options', () => {
  it('plain fire when no options', async () => {
    await callHandlerText(byName('fire_clip_with_options').handler, { track: 0, slot: 1 });
    expect(lom.lomCall).toHaveBeenCalledWith(slotPath(0, 1), 'fire');
  });

  it('record_length only', async () => {
    await callHandlerText(byName('fire_clip_with_options').handler, {
      track: 0,
      slot: 1,
      record_length: 8,
    });
    expect(lom.lomCall).toHaveBeenLastCalledWith(slotPath(0, 1), 'fire', 8);
  });

  it('throws when launch_quantization is alone', async () => {
    await expect(
      byName('fire_clip_with_options').handler({ track: 0, slot: 1, launch_quantization: 4 }),
    ).rejects.toThrow(/requires record_length/);
  });

  it('both record_length + launch_quantization', async () => {
    await callHandlerText(byName('fire_clip_with_options').handler, {
      track: 0,
      slot: 1,
      record_length: 8,
      launch_quantization: 4,
    });
    expect(lom.lomCall).toHaveBeenLastCalledWith(slotPath(0, 1), 'fire', 8, 4);
  });
});

describe('clip lifecycle', () => {
  it('fire_clip → fire on clip path', async () => {
    await callHandlerText(byName('fire_clip').handler, { track: 0, slot: 1 });
    expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'fire');
  });

  it('stop_all_clips → live_set stop_all_clips', async () => {
    await callHandlerText(byName('stop_all_clips').handler);
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'stop_all_clips');
  });

  it('delete_clip → delete_clip on slot path', async () => {
    await callHandlerText(byName('delete_clip').handler, { track: 0, slot: 1 });
    expect(lom.lomCall).toHaveBeenCalledWith(slotPath(0, 1), 'delete_clip');
  });

  it('set_clip_name writes name', async () => {
    await callHandlerText(byName('set_clip_name').handler, { track: 0, slot: 1, name: 'Verse' });
    expect(lom.lomSet).toHaveBeenCalledWith(clipPath(0, 1), 'name', 'Verse');
  });

  it('set_clip_color writes color and uppercases hex in successText', async () => {
    expect(
      await callHandlerText(byName('set_clip_color').handler, {
        track: 0,
        slot: 1,
        color: 0xff8800,
      }),
    ).toContain('0xFF8800');
  });
});

describe('quantize_clip', () => {
  it('calls quantize on clip path with grid + amount', async () => {
    await callHandlerText(byName('quantize_clip').handler, {
      track: 0,
      slot: 1,
      grid: 7,
      amount: 1,
    });
    expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'quantize', 7, 1);
  });
});

describe('readers', () => {
  it.each([
    [
      'get_clip_notes',
      'lomGetClipNotes',
      { track: 0, slot: 1, from_pitch: 0, pitch_span: 128, from_time: 0, time_span: 16 },
      [0, 1, 0, 128, 0, 16],
      'CLIP_NOTES',
    ],
    ['get_all_notes_extended', 'lomGetAllNotes', { track: 0, slot: 1 }, [0, 1], 'ALL_NOTES'],
    [
      'get_selected_notes_extended',
      'lomGetSelectedNotes',
      { track: 0, slot: 1 },
      [0, 1],
      'SEL_NOTES',
    ],
  ])('%s delegates and returns the JSON', async (name, helper, args, expectedArgs, payload) => {
    const text = await callHandlerText(byName(name).handler, args);
    expect(lom[helper]).toHaveBeenCalledWith(...expectedArgs);
    expect(text).toBe(payload);
  });

  it('get_notes_by_id JSONifies ids', async () => {
    await callHandlerText(byName('get_notes_by_id').handler, { track: 0, slot: 1, ids: [10, 11] });
    expect(lom.lomGetNotesById).toHaveBeenCalledWith(0, 1, '[10,11]');
  });
});

describe('apply_note_modifications', () => {
  it('wraps the notes array in {notes: ...} JSON', async () => {
    await callHandlerText(byName('apply_note_modifications').handler, {
      track: 0,
      slot: 1,
      notes: [{ note_id: 1, pitch: 64 }],
    });
    expect(lom.lomApplyNoteModifications).toHaveBeenCalledWith(
      0,
      1,
      '{"notes":[{"note_id":1,"pitch":64}]}',
    );
  });
});

describe('add_warp_marker', () => {
  it('forwards beat_time when provided', async () => {
    await callHandlerText(byName('add_warp_marker').handler, { track: 0, slot: 1, beat_time: 1 });
    expect(lom.lomAddWarpMarker).toHaveBeenCalledWith(0, 1, 1, undefined);
  });

  it('forwards sample_time when provided', async () => {
    await callHandlerText(byName('add_warp_marker').handler, {
      track: 0,
      slot: 1,
      sample_time: 22050,
    });
    expect(lom.lomAddWarpMarker).toHaveBeenLastCalledWith(0, 1, undefined, 22050);
  });

  it('throws when both omitted', async () => {
    await expect(byName('add_warp_marker').handler({ track: 0, slot: 1 })).rejects.toThrow(
      /at least one of beat_time/,
    );
  });
});

describe('replace_clip_notes', () => {
  it('JSONifies notes and forwards', async () => {
    const notes = [{ pitch: 60, time: 0, duration: 1, velocity: 100 }];
    await callHandlerText(byName('replace_clip_notes').handler, { track: 0, slot: 1, notes });
    expect(lom.lomReplaceClipNotes).toHaveBeenCalledWith(0, 1, JSON.stringify(notes));
  });
});
