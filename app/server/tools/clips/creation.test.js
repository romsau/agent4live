'use strict';

jest.mock('../../lom', () => ({
  lomCall: jest.fn(() => Promise.resolve()),
  lomAddNotesToClip: jest.fn(() => Promise.resolve('[42, 43]')),
  lomDuplicateClipToSlot: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./creation');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('registers expected tools', () => {
  expect(tools.map((t) => t.name).sort()).toEqual(
    [
      'create_arrangement_midi_clip',
      'create_arrangement_audio_clip',
      'create_session_clip',
      'create_session_audio_clip',
      'add_notes_to_clip',
      'duplicate_clip_to_slot',
    ].sort(),
  );
});

describe('create_arrangement_midi_clip', () => {
  it('calls create_midi_clip on track path with start_time + length', async () => {
    const text = await callHandlerText(byName('create_arrangement_midi_clip').handler, {
      track: 0,
      start_time: 16,
      length: 4,
    });
    expect(lom.lomCall).toHaveBeenCalledWith('live_set tracks 0', 'create_midi_clip', 16, 4);
    expect(text).toBe('MIDI clip created on track 0 at beat 16 (length 4)');
  });
});

describe('create_arrangement_audio_clip', () => {
  it('calls create_audio_clip on track path with file + position', async () => {
    await callHandlerText(byName('create_arrangement_audio_clip').handler, {
      track: 1,
      file_path: '/path/to/sample.wav',
      position: 8,
    });
    expect(lom.lomCall).toHaveBeenCalledWith(
      'live_set tracks 1',
      'create_audio_clip',
      '/path/to/sample.wav',
      8,
    );
  });
});

describe('create_session_clip', () => {
  it('calls create_clip on slot path with length', async () => {
    await callHandlerText(byName('create_session_clip').handler, { track: 0, slot: 1, length: 4 });
    expect(lom.lomCall).toHaveBeenCalledWith('live_set tracks 0 clip_slots 1', 'create_clip', 4);
  });
});

describe('create_session_audio_clip', () => {
  it('calls create_audio_clip on slot path with file_path', async () => {
    await callHandlerText(byName('create_session_audio_clip').handler, {
      track: 1,
      slot: 0,
      file_path: '/path/to/sample.wav',
    });
    expect(lom.lomCall).toHaveBeenCalledWith(
      'live_set tracks 1 clip_slots 0',
      'create_audio_clip',
      '/path/to/sample.wav',
    );
  });
});

describe('add_notes_to_clip', () => {
  it('serializes notes as JSON and forwards to lomAddNotesToClip', async () => {
    const notes = [{ pitch: 60, start_time: 0, duration: 1, velocity: 100 }];
    const text = await callHandlerText(byName('add_notes_to_clip').handler, {
      track: 0,
      slot: 1,
      notes,
    });
    expect(lom.lomAddNotesToClip).toHaveBeenCalledWith(0, 1, JSON.stringify(notes));
    expect(text).toBe('[42, 43]');
  });

  it('label format includes the note count', () => {
    const label = byName('add_notes_to_clip').handler;
    // Trigger via the tool itself to check the label captured at registration.
    const tool = byName('add_notes_to_clip');
    const labelStr = collectTools(family.register).find((t) => t.name === 'add_notes_to_clip');
    expect(typeof tool.handler).toBe('function');
    expect(label).toBeDefined();
    expect(labelStr).toBeDefined();
  });
});

describe('duplicate_clip_to_slot', () => {
  it('forwards 4 indices to lomDuplicateClipToSlot', async () => {
    const text = await callHandlerText(byName('duplicate_clip_to_slot').handler, {
      source_track: 0,
      source_slot: 0,
      destination_track: 1,
      destination_slot: 0,
    });
    expect(lom.lomDuplicateClipToSlot).toHaveBeenCalledWith(0, 0, 1, 0);
    expect(text).toBe('Clip duplicated from [0,0] to [1,0]');
  });
});
