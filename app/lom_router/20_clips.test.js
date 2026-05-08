'use strict';

const clips = require('./20_clips');
const {
  lom_get_clip_notes,
  lom_replace_clip_notes,
  lom_apply_note_modifications,
  lom_get_all_notes,
  lom_get_selected_notes,
  lom_get_notes_by_id,
  lom_add_warp_marker,
  lom_add_clip,
  lom_clear_clip_envelope,
  lom_duplicate_clip_to_arrangement,
  lom_delete_arrangement_clip,
  lom_remove_notes_by_id,
  lom_duplicate_notes_by_id,
  lom_add_notes_to_clip,
  lom_duplicate_clip_to_slot,
  lom_set_clip_groove,
  lom_get_clip_audio_info,
  lom_get_warp_markers,
} = clips;

beforeEach(() => {
  outlet.mockClear();
});

/**
 * Patch global.LiveAPI so each constructor returns the response from the
 * map, keyed by the path string. Returns a {restore} for cleanup.
 * @param byPath
 */
function patchLiveAPI(byPath) {
  const original = global.LiveAPI;
  global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
    const path = args[0];
    return byPath(path, args) || {};
  });
  return { restore: () => (global.LiveAPI = original) };
}

describe('note readers (clip.call → _dictReturnToJson)', () => {
  it('lom_get_clip_notes calls get_notes_extended with parsed numeric args', () => {
    const callSpy = jest.fn(() => '{"notes":[]}');
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_get_clip_notes(1, 0, 0, 60, 12, 0, 4);
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('get_notes_extended', 60, 12, 0, 4);
    expect(outlet.mock.calls.at(-1)[4]).toBe('{"notes":[]}');
  });

  it.each([
    ['lom_get_all_notes', 'get_all_notes_extended', () => lom_get_all_notes(1, 0, 0)],
    [
      'lom_get_selected_notes',
      'get_selected_notes_extended',
      () => lom_get_selected_notes(1, 0, 0),
    ],
  ])('%s calls %s', (name, method, run) => {
    const callSpy = jest.fn(() => '{"notes":[]}');
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      run();
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith(method);
  });

  it('lom_get_notes_by_id splats the id array as varargs', () => {
    const callSpy = jest.fn(() => '{"notes":[]}');
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_get_notes_by_id(1, 0, 0, '[42, 43]');
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('get_notes_by_id', 42, 43);
  });
});

describe('lom_replace_clip_notes', () => {
  it('wipes then writes notes via Dict', () => {
    const callSpy = jest.fn();
    const getSpy = jest.fn((k) => (k === 'length' ? 16 : null));
    const { restore } = patchLiveAPI(() => ({ call: callSpy, get: getSpy }));
    try {
      lom_replace_clip_notes(
        1,
        0,
        0,
        '[{"pitch":60,"time":0,"duration":1,"velocity":100,"mute":0}]'
      );
    } finally {
      restore();
    }
    // First call: wipe
    expect(callSpy).toHaveBeenNthCalledWith(1, 'remove_notes_extended', 0, 128, 0, 16);
    // Second call: add_new_notes with Dict
    expect(callSpy.mock.calls[1][0]).toBe('add_new_notes');
    expect(outlet.mock.calls.at(-1)[4]).toBe('done');
  });

  it('skips add_new_notes when notes array is empty', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({
      call: callSpy,
      get: () => 16,
    }));
    try {
      lom_replace_clip_notes(1, 0, 0, '[]');
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledTimes(1); // just the wipe
  });

  it('defaults velocity=100 and mute=0 when missing', () => {
    const callSpy = jest.fn();
    const dictParseSpy = jest.fn();
    const originalDict = global.Dict;
    global.Dict = jest.fn().mockImplementation(() => ({
      parse: dictParseSpy,
      stringify: () => '{}',
    }));
    const { restore } = patchLiveAPI(() => ({ call: callSpy, get: () => 16 }));
    try {
      lom_replace_clip_notes(1, 0, 0, '[{"pitch":60,"time":0,"duration":1}]');
    } finally {
      restore();
      global.Dict = originalDict;
    }
    const written = JSON.parse(dictParseSpy.mock.calls[0][0]);
    expect(written.notes[0]).toMatchObject({ velocity: 100, mute: 0 });
  });
});

describe('lom_apply_note_modifications', () => {
  it('parses notesJson into a Dict and calls apply_note_modifications', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_apply_note_modifications(1, 0, 0, '{"notes":[{"note_id":1,"pitch":64}]}');
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('apply_note_modifications', expect.any(Object));
  });
});

describe('lom_add_warp_marker', () => {
  it('writes a Dict with both beat_time and sample_time when provided', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_add_warp_marker(1, 0, 0, 4, 22050);
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('add_warp_marker', expect.any(Object));
  });

  it('throws when both beat_time and sample_time are NaN/undefined', () => {
    const { restore } = patchLiveAPI(() => ({ call: jest.fn() }));
    try {
      lom_add_warp_marker(1, 0, 0, undefined, undefined);
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });

  it('handles only beat_time provided (sample_time NaN)', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_add_warp_marker(1, 0, 0, 1, NaN);
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('add_warp_marker', expect.any(Object));
  });

  it('handles only sample_time provided (beat_time NaN)', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_add_warp_marker(1, 0, 0, NaN, 22050);
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('add_warp_marker', expect.any(Object));
  });
});

describe('lom_add_clip', () => {
  it('creates the slot clip without notes when notes array is empty', () => {
    const slotCallSpy = jest.fn();
    const clipCallSpy = jest.fn();
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 clip_slots 0') return { call: slotCallSpy };
      if (path === 'live_set tracks 0 clip_slots 0 clip') return { call: clipCallSpy };
      return null;
    });
    try {
      lom_add_clip(1, 0, 0, 4, '[]');
    } finally {
      restore();
    }
    expect(slotCallSpy).toHaveBeenCalledWith('create_clip', 4);
    expect(clipCallSpy).not.toHaveBeenCalled();
  });

  it('seeds notes via Dict on the new clip path', () => {
    const slotCallSpy = jest.fn();
    const clipCallSpy = jest.fn();
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 clip_slots 0') return { call: slotCallSpy };
      if (path === 'live_set tracks 0 clip_slots 0 clip') return { call: clipCallSpy };
      return null;
    });
    try {
      lom_add_clip(1, 0, 0, 4, '[{"pitch":60,"time":0,"duration":1,"velocity":100,"mute":0}]');
    } finally {
      restore();
    }
    expect(clipCallSpy).toHaveBeenCalledWith('add_new_notes', expect.any(Object));
  });

  it('defaults velocity=100 and mute=0 when missing', () => {
    const slotCallSpy = jest.fn();
    const clipCallSpy = jest.fn();
    const dictParseSpy = jest.fn();
    const originalDict = global.Dict;
    global.Dict = jest.fn().mockImplementation(() => ({
      parse: dictParseSpy,
      stringify: () => '{}',
    }));
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 clip_slots 0') return { call: slotCallSpy };
      if (path === 'live_set tracks 0 clip_slots 0 clip') return { call: clipCallSpy };
      return null;
    });
    try {
      lom_add_clip(1, 0, 0, 4, '[{"pitch":60,"time":0,"duration":1}]');
    } finally {
      restore();
      global.Dict = originalDict;
    }
    const written = JSON.parse(dictParseSpy.mock.calls[0][0]);
    expect(written.notes[0]).toMatchObject({ velocity: 100, mute: 0 });
  });
});

describe('lom_clear_clip_envelope', () => {
  it('outlets ok and calls clip.clear_envelope with the param id', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 clip_slots 0 clip') return { call: callSpy };
      if (path === 'live_set tracks 0 devices 0 parameters 5') return { id: 99 };
      return null;
    });
    try {
      lom_clear_clip_envelope(1, 0, 0, 0, 5);
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('clear_envelope', 'id', 99);
  });

  it('throws when parameter id is missing', () => {
    const { restore } = patchLiveAPI(() => ({ id: 0, call: () => {} }));
    try {
      lom_clear_clip_envelope(1, 0, 0, 0, 5);
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });
});

describe('lom_duplicate_clip_to_arrangement', () => {
  it('outlets ok and calls duplicate_clip_to_arrangement with clipId + destTime', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 clip_slots 1 clip') return { id: 11 };
      if (path === 'live_set tracks 0') return { call: callSpy };
      return null;
    });
    try {
      lom_duplicate_clip_to_arrangement(1, 0, 1, 16);
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('duplicate_clip_to_arrangement', 'id', 11, 16);
  });

  it('throws when source clip id is missing', () => {
    const { restore } = patchLiveAPI(() => ({ id: 0 }));
    try {
      lom_duplicate_clip_to_arrangement(1, 0, 1, 16);
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });
});

describe('lom_delete_arrangement_clip', () => {
  it('calls delete_clip with the resolved id', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({
      get: () => ['id', 7, 'id', 8],
      call: callSpy,
    }));
    try {
      lom_delete_arrangement_clip(1, 0, 1);
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('delete_clip', 'id', 8);
  });

  it('throws when arrangement_clips index is out of range', () => {
    const { restore } = patchLiveAPI(() => ({
      get: () => ['id', 7],
      call: jest.fn(),
    }));
    try {
      lom_delete_arrangement_clip(1, 0, 5);
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });

  it('throws when arrangement_clips returns nothing', () => {
    const { restore } = patchLiveAPI(() => ({
      get: () => null, // falls back to []
      call: jest.fn(),
    }));
    try {
      lom_delete_arrangement_clip(1, 0, 0);
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });
});

describe('lom_remove_notes_by_id', () => {
  it('calls remove_notes_by_id with splatted ids', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_remove_notes_by_id(1, 0, 0, '[42, 43]');
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('remove_notes_by_id', 42, 43);
  });

  it('returns no-op for empty ids', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_remove_notes_by_id(1, 0, 0, '[]');
    } finally {
      restore();
    }
    expect(callSpy).not.toHaveBeenCalled();
    expect(outlet.mock.calls.at(-1)[4]).toBe('no-op');
  });

  it('returns no-op for non-array idsJson', () => {
    const { restore } = patchLiveAPI(() => ({ call: jest.fn() }));
    try {
      lom_remove_notes_by_id(1, 0, 0, '{}');
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[4]).toBe('no-op');
  });
});

describe('lom_duplicate_notes_by_id', () => {
  it('writes spec with note_ids only when others omitted', () => {
    const callSpy = jest.fn();
    const dictParseSpy = jest.fn();
    const originalDict = global.Dict;
    global.Dict = jest.fn().mockImplementation(() => ({
      parse: dictParseSpy,
      stringify: () => '{}',
    }));
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_duplicate_notes_by_id(1, 0, 0, '{"note_ids":[1]}');
    } finally {
      restore();
      global.Dict = originalDict;
    }
    const spec = JSON.parse(dictParseSpy.mock.calls[0][0]);
    expect(spec.note_ids).toEqual([1]);
    expect(spec.destination_time).toBeUndefined();
    expect(spec.transposition_amount).toBeUndefined();
  });

  it('includes destination_time and transposition_amount when provided', () => {
    const dictParseSpy = jest.fn();
    const originalDict = global.Dict;
    global.Dict = jest.fn().mockImplementation(() => ({
      parse: dictParseSpy,
      stringify: () => '{}',
    }));
    const { restore } = patchLiveAPI(() => ({ call: jest.fn() }));
    try {
      lom_duplicate_notes_by_id(
        1,
        0,
        0,
        '{"note_ids":[1],"destination_time":4,"transposition_amount":2}'
      );
    } finally {
      restore();
      global.Dict = originalDict;
    }
    const spec = JSON.parse(dictParseSpy.mock.calls[0][0]);
    expect(spec).toEqual({ note_ids: [1], destination_time: 4, transposition_amount: 2 });
  });

  it('skips null destination_time/transposition_amount fields', () => {
    const dictParseSpy = jest.fn();
    const originalDict = global.Dict;
    global.Dict = jest.fn().mockImplementation(() => ({
      parse: dictParseSpy,
      stringify: () => '{}',
    }));
    const { restore } = patchLiveAPI(() => ({ call: jest.fn() }));
    try {
      lom_duplicate_notes_by_id(
        1,
        0,
        0,
        '{"note_ids":[1],"destination_time":null,"transposition_amount":null}'
      );
    } finally {
      restore();
      global.Dict = originalDict;
    }
    const spec = JSON.parse(dictParseSpy.mock.calls[0][0]);
    expect(spec.destination_time).toBeUndefined();
    expect(spec.transposition_amount).toBeUndefined();
  });
});

describe('lom_add_notes_to_clip', () => {
  it('returns "[]" when notes array is empty', async () => {
    const { restore } = patchLiveAPI(() => ({ call: jest.fn() }));
    try {
      lom_add_notes_to_clip(1, 0, 0, '[]');
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[4]).toBe('[]');
  });

  it('returns "[]" for non-array notesJson', () => {
    const { restore } = patchLiveAPI(() => ({ call: jest.fn() }));
    try {
      lom_add_notes_to_clip(1, 0, 0, '{}');
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[4]).toBe('[]');
  });

  it('serializes notes and outlets the returned ids', () => {
    const callSpy = jest.fn(() => [42, 43]);
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_add_notes_to_clip(
        1,
        0,
        0,
        '[{"pitch":60,"start_time":0,"duration":1,"velocity":100,"mute":0,"probability":0.8,"velocity_deviation":5,"release_velocity":50}]'
      );
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('add_new_notes', expect.any(Object));
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual([42, 43]);
  });

  it('uses n.time as fallback when start_time absent and defaults velocity to 100', () => {
    const dictParseSpy = jest.fn();
    const originalDict = global.Dict;
    global.Dict = jest.fn().mockImplementation(() => ({
      parse: dictParseSpy,
      stringify: () => '{}',
    }));
    const { restore } = patchLiveAPI(() => ({ call: jest.fn(() => null) }));
    try {
      lom_add_notes_to_clip(1, 0, 0, '[{"pitch":60,"time":2,"duration":1}]');
    } finally {
      restore();
      global.Dict = originalDict;
    }
    const spec = JSON.parse(dictParseSpy.mock.calls[0][0]);
    expect(spec.notes[0]).toMatchObject({ start_time: 2, velocity: 100 });
  });

  it('wraps single-id return as a one-element array', () => {
    const { restore } = patchLiveAPI(() => ({ call: () => 42 }));
    try {
      lom_add_notes_to_clip(1, 0, 0, '[{"pitch":60,"time":0,"duration":1,"velocity":100}]');
    } finally {
      restore();
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual([42]);
  });

  it('returns [] when add_new_notes returns falsy', () => {
    const { restore } = patchLiveAPI(() => ({ call: () => null }));
    try {
      lom_add_notes_to_clip(1, 0, 0, '[{"pitch":60,"time":0,"duration":1,"velocity":100}]');
    } finally {
      restore();
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual([]);
  });
});

describe('lom_duplicate_clip_to_slot', () => {
  it('calls src.duplicate_clip_to with destination id', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 clip_slots 0') return { call: callSpy };
      if (path === 'live_set tracks 1 clip_slots 0') return { id: 99 };
      return null;
    });
    try {
      lom_duplicate_clip_to_slot(1, 0, 0, 1, 0);
    } finally {
      restore();
    }
    expect(callSpy).toHaveBeenCalledWith('duplicate_clip_to', 'id', 99);
  });

  it('throws when destination slot id is missing', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 clip_slots 0') return { call: jest.fn() };
      return { id: 0 };
    });
    try {
      lom_duplicate_clip_to_slot(1, 0, 0, 1, 0);
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });
});

describe('lom_set_clip_groove', () => {
  it('clears the groove when grooveIndex is negative', () => {
    const setSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ set: setSpy, id: 0 }));
    try {
      lom_set_clip_groove(1, 0, 0, -1);
    } finally {
      restore();
    }
    expect(setSpy).toHaveBeenCalledWith('groove', 'id', 0);
    expect(outlet.mock.calls.at(-1)[4]).toBe('cleared');
  });

  it('sets groove by id when index resolves', () => {
    const setSpy = jest.fn();
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 clip_slots 0 clip') return { set: setSpy };
      if (path === 'live_set groove_pool grooves 2') return { id: 77 };
      return null;
    });
    try {
      lom_set_clip_groove(1, 0, 0, 2);
    } finally {
      restore();
    }
    expect(setSpy).toHaveBeenCalledWith('groove', 'id', 77);
  });

  it('throws when groove id is missing', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 clip_slots 0 clip') return { set: jest.fn() };
      return { id: 0 };
    });
    try {
      lom_set_clip_groove(1, 0, 0, 99);
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });
});

describe('lom_get_clip_audio_info', () => {
  it('returns full info for an audio clip', () => {
    const { restore } = patchLiveAPI(() => ({
      get: (key) => {
        const map = {
          is_audio_clip: 1,
          file_path: '/sample.wav',
          sample_length: 88200,
          sample_rate: 44100,
          warping: 1,
          warp_mode: 0,
          gain: 0.5,
          pitch_coarse: 0,
          pitch_fine: 0,
          start_marker: 0,
          end_marker: 4,
          ram_mode: 0,
        };
        return map[key];
      },
    }));
    try {
      lom_get_clip_audio_info(1, 0, 0);
    } finally {
      restore();
    }
    const info = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(info.is_audio_clip).toBe(true);
    expect(info.file_path).toBe('/sample.wav');
    expect(info.sample_length).toBe(88200);
  });

  it('returns just is_audio_clip=false for MIDI clips', () => {
    const { restore } = patchLiveAPI(() => ({ get: () => 0 }));
    try {
      lom_get_clip_audio_info(1, 0, 0);
    } finally {
      restore();
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual({ is_audio_clip: false });
  });

  it('falls back to empty string when file_path is falsy', () => {
    const { restore } = patchLiveAPI(() => ({
      get: (key) => (key === 'is_audio_clip' ? 1 : null),
    }));
    try {
      lom_get_clip_audio_info(1, 0, 0);
    } finally {
      restore();
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).file_path).toBe('');
  });
});

describe('lom_get_warp_markers', () => {
  it('unwraps single-element-array JSON envelope (Live 12+)', () => {
    const { restore } = patchLiveAPI(() => ({
      get: () => [JSON.stringify({ warp_markers: [{ beat_time: 0, sample_time: 0 }] })],
    }));
    try {
      lom_get_warp_markers(1, 0, 0);
    } finally {
      restore();
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual([{ beat_time: 0, sample_time: 0 }]);
  });

  it('returns parsed envelope when warp_markers key is absent', () => {
    const { restore } = patchLiveAPI(() => ({
      get: () => JSON.stringify({ unrelated: 'x' }),
    }));
    try {
      lom_get_warp_markers(1, 0, 0);
    } finally {
      restore();
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual({ unrelated: 'x' });
  });

  it('falls through to _dictReturnToJson on malformed JSON', () => {
    const originalDict = global.Dict;
    global.Dict = function (name) {
      return { stringify: () => `dict[${name}]` };
    };
    const { restore } = patchLiveAPI(() => ({ get: () => '{malformed' }));
    try {
      lom_get_warp_markers(1, 0, 0);
    } finally {
      restore();
      global.Dict = originalDict;
    }
    // _dictReturnToJson sees '{malformed' starts with '{' and returns it as-is
    expect(outlet.mock.calls.at(-1)[4]).toBe('{malformed');
  });

  it('falls back to _dictReturnToJson for older Live (Dict-name pattern)', () => {
    const originalDict = global.Dict;
    global.Dict = function (name) {
      return { stringify: () => `dict_${name}` };
    };
    const { restore } = patchLiveAPI(() => ({ get: () => 'old_dict' }));
    try {
      lom_get_warp_markers(1, 0, 0);
    } finally {
      restore();
      global.Dict = originalDict;
    }
    expect(outlet.mock.calls.at(-1)[4]).toBe('dict_old_dict');
  });
});
