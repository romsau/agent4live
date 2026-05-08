'use strict';

const session = require('./70_session');
const {
  lom_set_cue_point_name,
  lom_set_cue_point_time,
  lom_jump_to_cue,
  lom_get_cue_points,
  lom_get_grooves,
  lom_get_take_lanes,
  lom_get_selection,
  lom_select_track,
  lom_select_scene,
  lom_get_track_group_info,
  lom_get_scale,
  lom_get_control_surfaces,
  lom_get_control_surface_controls,
} = session;

beforeEach(() => {
  outlet.mockClear();
});

describe('cue point setters / jump', () => {
  // _resolveCueId calls `new LiveAPI(null, 'live_set')` then resolves cue_points[idx].
  // We mock LiveAPI to return a parent with cue_points = ['id', cueId], and a
  // LiveAPI by id to return the cue point object. Or, when `cueId` is 0,
  // _byId returns null and the helpers throw.

  function setupCueLookup(cueIdForIndex0) {
    const cpSet = jest.fn();
    const cpCall = jest.fn();
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      const path = args[0];
      if (path === 'live_set') {
        return { get: () => (cueIdForIndex0 !== 0 ? ['id', cueIdForIndex0] : []) };
      }
      if (args[0] === 'id' && args[1] === cueIdForIndex0) {
        return { set: cpSet, call: cpCall };
      }
      return null;
    });
    return { cpSet, cpCall, restore: () => (global.LiveAPI = original) };
  }

  it('lom_set_cue_point_name writes the name', () => {
    const { cpSet, restore } = setupCueLookup(42);
    try {
      lom_set_cue_point_name(1, 0, 'Verse');
    } finally {
      restore();
    }
    expect(cpSet).toHaveBeenCalledWith('name', 'Verse');
    expect(outlet.mock.calls.at(-1)[3]).toBe('ok');
  });

  it('lom_set_cue_point_time writes the parsed-float time', () => {
    const { cpSet, restore } = setupCueLookup(42);
    try {
      lom_set_cue_point_time(1, 0, '16');
    } finally {
      restore();
    }
    expect(cpSet).toHaveBeenCalledWith('time', 16);
  });

  it('lom_jump_to_cue calls jump on the cue', () => {
    const { cpCall, restore } = setupCueLookup(42);
    try {
      lom_jump_to_cue(1, 0);
    } finally {
      restore();
    }
    expect(cpCall).toHaveBeenCalledWith('jump');
  });

  it.each([
    ['lom_set_cue_point_name', () => lom_set_cue_point_name(1, 0, 'X')],
    ['lom_set_cue_point_time', () => lom_set_cue_point_time(1, 0, 0)],
    ['lom_jump_to_cue', () => lom_jump_to_cue(1, 0)],
  ])('%s outlets error when cue point is missing', (name, run) => {
    const { restore } = setupCueLookup(0); // 0 = no cue
    try {
      run();
    } finally {
      restore();
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
    expect(outlet.mock.calls.at(-1)[4]).toMatch(/No cue point/);
  });
});

describe('lom_get_cue_points', () => {
  it('iterates cue_points and outlets [{name, time}]', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set') {
        return { get: () => ['id', 11, 'id', 22] };
      }
      if (args[0] === 'id') {
        const id = args[1];
        return {
          get: (key) => {
            if (key === 'name') return id === 11 ? ['Verse'] : ['Drop'];
            if (key === 'time') return id === 11 ? [4] : [16];
            return null;
          },
        };
      }
      return null;
    });
    try {
      lom_get_cue_points(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual([
      { name: 'Verse', time: 4 },
      { name: 'Drop', time: 16 },
    ]);
  });
});

describe('lom_get_grooves', () => {
  it('outlets array of groove descriptors', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      const path = args[0];
      if (path === 'live_set groove_pool') return { getcount: () => 1 };
      // grooves N
      return {
        get: (key) => {
          if (key === 'name') return 'Funk';
          if (key === 'base') return 1;
          if (key === 'quantization_amount') return 0.5;
          if (key === 'random_amount') return 0.1;
          if (key === 'timing_amount') return 0.3;
          if (key === 'velocity_amount') return 0.2;
          return null;
        },
      };
    });
    try {
      lom_get_grooves(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual([
      {
        index: 0,
        name: 'Funk',
        base: 1,
        quantization_amount: 0.5,
        random_amount: 0.1,
        timing_amount: 0.3,
        velocity_amount: 0.2,
      },
    ]);
  });

  it('falsy groove name falls back to empty string', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      const path = args[0];
      if (path === 'live_set groove_pool') return { getcount: () => 1 };
      return { get: () => null };
    });
    try {
      lom_get_grooves(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])[0].name).toBe('');
  });
});

describe('lom_get_take_lanes', () => {
  it('outlets [{index, name}, ...]', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      const path = args[0];
      if (path === 'live_set tracks 0') return { getcount: () => 1 };
      return { get: () => 'Take 1' };
    });
    try {
      lom_get_take_lanes(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual([{ index: 0, name: 'Take 1' }]);
  });

  it('falsy take lane name falls back to empty string', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      const path = args[0];
      if (path === 'live_set tracks 0') return { getcount: () => 1 };
      return { get: () => null };
    });
    try {
      lom_get_take_lanes(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])[0].name).toBe('');
  });
});

describe('lom_get_selection', () => {
  it('outlets the parsed indices + paths + highlighted_clip_slot', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set view') {
        return {
          get: (key) => {
            if (key === 'selected_track') return ['id', 11];
            if (key === 'selected_scene') return ['id', 22];
            if (key === 'highlighted_clip_slot') return ['id', 33];
            if (key === 'detail_clip') return ['id', 44];
            if (key === 'selected_parameter') return ['id', 55];
            if (key === 'selected_chain') return ['id', 66];
            return null;
          },
        };
      }
      if (args[0] === 'id') {
        const idVal = args[1];
        const paths = {
          11: 'live_set tracks 3',
          22: 'live_set scenes 2',
          33: 'live_set tracks 1 clip_slots 0',
          44: 'live_set tracks 1 clip_slots 0 clip',
          55: 'live_set tracks 0 devices 0 parameters 5',
          66: 'live_set tracks 0 devices 0 chains 1',
        };
        return { path: paths[idVal] };
      }
      return null;
    });
    try {
      lom_get_selection(1);
    } finally {
      global.LiveAPI = original;
    }
    const r = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(r.selected_track_index).toBe(3);
    expect(r.selected_scene_index).toBe(2);
    expect(r.highlighted_clip_slot).toEqual({ track: 1, slot: 0 });
    expect(r.detail_clip_path).toBe('live_set tracks 1 clip_slots 0 clip');
    expect(r.selected_device_path).toBe('live_set tracks 0 devices 0 parameters 5');
    expect(r.selected_chain_path).toBe('live_set tracks 0 devices 0 chains 1');
  });

  it('returns null paths and -1 indices when nothing is selected', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set view') return { get: () => null };
      return null;
    });
    try {
      lom_get_selection(1);
    } finally {
      global.LiveAPI = original;
    }
    const r = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(r.selected_track_index).toBe(-1);
    expect(r.selected_scene_index).toBe(-1);
    expect(r.highlighted_clip_slot).toBeNull();
    expect(r.detail_clip_path).toBeNull();
  });

  it('strips quotes from the resolved path', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set view') {
        return { get: (k) => (k === 'detail_clip' ? ['id', 1] : null) };
      }
      if (args[0] === 'id') return { path: '"live_set tracks 5 clip_slots 2 clip"' };
      return null;
    });
    try {
      lom_get_selection(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).detail_clip_path).toBe(
      'live_set tracks 5 clip_slots 2 clip'
    );
  });

  it('returns null path when api.path is empty', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set view') {
        return { get: (k) => (k === 'detail_clip' ? ['id', 1] : null) };
      }
      if (args[0] === 'id') return { path: '' };
      return null;
    });
    try {
      lom_get_selection(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).detail_clip_path).toBeNull();
  });

  it('returns null path when _byId returns null (id 0)', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set view') {
        return { get: (k) => (k === 'detail_clip' ? ['id', 0] : null) };
      }
      return null;
    });
    try {
      lom_get_selection(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).detail_clip_path).toBeNull();
  });

  it('highlighted_clip_slot is null when its path does not match the clip-slot regex', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set view') {
        return { get: (k) => (k === 'highlighted_clip_slot' ? ['id', 1] : null) };
      }
      if (args[0] === 'id') return { path: 'live_set scenes 0' };
      return null;
    });
    try {
      lom_get_selection(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).highlighted_clip_slot).toBeNull();
  });

  it('returns -1 when path does not match the kind regex', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set view') {
        return { get: (k) => (k === 'selected_track' ? ['id', 1] : null) };
      }
      if (args[0] === 'id') return { path: 'something_unrelated' };
      return null;
    });
    try {
      lom_get_selection(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).selected_track_index).toBe(-1);
  });
});

describe('lom_select_track / lom_select_scene', () => {
  it('lom_select_track sets view.selected_track when id resolves', () => {
    const setSpy = jest.fn();
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set tracks 0') return { id: 11 };
      if (args[0] === 'live_set view') return { set: setSpy };
      return null;
    });
    try {
      lom_select_track(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(setSpy).toHaveBeenCalledWith('selected_track', 'id', 11);
  });

  it('lom_select_track throws when track is missing', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ id: 0 }));
    try {
      lom_select_track(1, 999);
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });

  it('lom_select_scene sets view.selected_scene', () => {
    const setSpy = jest.fn();
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set scenes 0') return { id: 22 };
      if (args[0] === 'live_set view') return { set: setSpy };
      return null;
    });
    try {
      lom_select_scene(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(setSpy).toHaveBeenCalledWith('selected_scene', 'id', 22);
  });

  it('lom_select_scene throws when scene is missing', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ id: 0 }));
    try {
      lom_select_scene(1, 999);
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });
});

describe('lom_get_track_group_info', () => {
  it('non-grouped track: group_track_index = -1', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => {
        if (key === 'is_foldable') return 0;
        if (key === 'is_grouped') return 0;
        if (key === 'fold_state') return 0;
        return null;
      },
    }));
    try {
      lom_get_track_group_info(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual({
      is_foldable: false,
      is_grouped: false,
      fold_state: 0,
      group_track_index: -1,
    });
  });

  it('grouped track resolves group_track_index from group_track path', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set tracks 1') {
        return {
          get: (key) => {
            if (key === 'is_foldable') return 0;
            if (key === 'is_grouped') return 1;
            if (key === 'fold_state') return 0;
            if (key === 'group_track') return ['id', 99];
            return null;
          },
        };
      }
      if (args[0] === 'id' && args[1] === 99) return { path: 'live_set tracks 5' };
      return null;
    });
    try {
      lom_get_track_group_info(1, 1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).group_track_index).toBe(5);
  });

  it('grouped track but malformed group_track ref → -1', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => {
        if (key === 'is_grouped') return 1;
        if (key === 'group_track') return null; // bad
        return 0;
      },
    }));
    try {
      lom_get_track_group_info(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).group_track_index).toBe(-1);
  });

  it('grouped track when group_track api.path is empty/falsy → -1', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set tracks 0') {
        return {
          get: (key) => {
            if (key === 'is_grouped') return 1;
            if (key === 'group_track') return ['id', 1];
            return 0;
          },
        };
      }
      if (args[0] === 'id') return { path: '' };
      return null;
    });
    try {
      lom_get_track_group_info(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).group_track_index).toBe(-1);
  });

  it('grouped track with id but group_track path lacks "tracks N" → -1', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args[0] === 'live_set tracks 0') {
        return {
          get: (key) => {
            if (key === 'is_grouped') return 1;
            if (key === 'group_track') return ['id', 1];
            return 0;
          },
        };
      }
      if (args[0] === 'id') return { path: 'something_weird' };
      return null;
    });
    try {
      lom_get_track_group_info(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).group_track_index).toBe(-1);
  });
});

describe('lom_get_scale', () => {
  it('parses JSON-envelope scale_intervals', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => {
        if (key === 'scale_intervals') return JSON.stringify({ scale_intervals: [0, 2, 4] });
        if (key === 'scale_name') return 'Major';
        if (key === 'root_note') return 0;
        if (key === 'scale_mode') return 1;
        return null;
      },
    }));
    try {
      lom_get_scale(1);
    } finally {
      global.LiveAPI = original;
    }
    const r = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(r).toEqual({
      scale_name: 'Major',
      root_note: 0,
      scale_mode: true,
      scale_intervals: [0, 2, 4],
    });
  });

  it('returns parsed envelope when scale_intervals key is absent', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => (key === 'scale_intervals' ? JSON.stringify({ unrelated: 'x' }) : null),
    }));
    try {
      lom_get_scale(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).scale_intervals).toEqual({ unrelated: 'x' });
  });

  it('falls back to empty intervals on malformed JSON', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => (key === 'scale_intervals' ? '{malformed' : null),
    }));
    try {
      lom_get_scale(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).scale_intervals).toEqual([]);
  });

  it('unwraps single-element-array JSON envelope', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) =>
        key === 'scale_intervals' ? [JSON.stringify({ scale_intervals: [0, 4, 7] })] : null,
    }));
    try {
      lom_get_scale(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).scale_intervals).toEqual([0, 4, 7]);
  });

  it('uses the array directly when scale_intervals is a multi-element array', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => (key === 'scale_intervals' ? [0, 3, 7] : null),
    }));
    try {
      lom_get_scale(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).scale_intervals).toEqual([0, 3, 7]);
  });

  it('falls back to empty intervals when scale_intervals is something else', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => (key === 'scale_intervals' ? 42 : null),
    }));
    try {
      lom_get_scale(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).scale_intervals).toEqual([]);
  });

  it('falsy scale_name falls back to empty string', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => {
        if (key === 'scale_intervals') return [];
        return null; // scale_name etc. all null
      },
    }));
    try {
      lom_get_scale(1);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4]).scale_name).toBe('');
  });
});

describe('control surfaces', () => {
  it('lom_get_control_surfaces lists slots, marks "is_connected" correctly', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      if (args.length === 0) {
        // app constructor: new LiveAPI() then app.path = 'live_app'
        return { getcount: () => 3 };
      }
      // control_surfaces N
      const idx = parseInt(args[0].match(/\d+/)[0], 10);
      const typeName = ['Push2', 'None', ''][idx];
      return { get: () => typeName };
    });
    try {
      lom_get_control_surfaces(1);
    } finally {
      global.LiveAPI = original;
    }
    const r = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(r).toEqual([
      { index: 0, type_name: 'Push2', is_connected: true },
      { index: 1, type_name: 'None', is_connected: false },
      { index: 2, type_name: 'None', is_connected: false }, // empty string → 'None'
    ]);
  });

  it('lom_get_control_surface_controls lists names', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: () => ['Play_Button', 'Tap_Tempo'],
    }));
    try {
      lom_get_control_surface_controls(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual(['Play_Button', 'Tap_Tempo']);
  });

  it('lom_get_control_surface_controls wraps single value into a single-element array', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ get: () => 'OnlyOne' }));
    try {
      lom_get_control_surface_controls(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual(['OnlyOne']);
  });

  it('lom_get_control_surface_controls returns [] when raw is falsy', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ get: () => null }));
    try {
      lom_get_control_surface_controls(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(JSON.parse(outlet.mock.calls.at(-1)[4])).toEqual([]);
  });
});
