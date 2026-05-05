'use strict';

// Tests for 00_helpers.js — the cross-domain helpers used by every other
// lom_router/<domain>.js. Pure logic ; the few helpers that touch LiveAPI
// stub it ad-hoc.

const helpers = require('./00_helpers');
const {
  _handle,
  _clipPath,
  _slotPath,
  _trackPath,
  _devicePath,
  _dictReturnToJson,
  _ioListProp,
  _byId,
  _resolveChildId,
  _foreachChild,
  _resolveCueId,
  _unwrap,
  _rackPath,
  _chainPath,
  _drumPadPath,
} = helpers;

beforeEach(() => {
  outlet.mockClear();
});

describe('_handle', () => {
  it('outlets the function return value with status "ok"', () => {
    _handle(7, () => 'value');
    expect(outlet).toHaveBeenCalledWith(0, 'lom_response', 7, 'ok', 'value');
  });

  it('outlets the error message with status "error" when fn throws', () => {
    _handle(7, () => {
      throw new Error('boom');
    });
    expect(outlet).toHaveBeenCalledWith(0, 'lom_response', 7, 'error', 'boom');
  });
});

describe('path builders', () => {
  it.each([
    [_clipPath, [0, 1], 'live_set tracks 0 clip_slots 1 clip'],
    [_slotPath, [0, 1], 'live_set tracks 0 clip_slots 1'],
    [_trackPath, [3], 'live_set tracks 3'],
    [_devicePath, [0, 2], 'live_set tracks 0 devices 2'],
    [_rackPath, [0, 0], 'live_set tracks 0 devices 0'],
    [_chainPath, [0, 0, 1], 'live_set tracks 0 devices 0 chains 1'],
    [_drumPadPath, [0, 0, 36], 'live_set tracks 0 devices 0 drum_pads 36'],
  ])('builds the right path', (fn, args, expected) => {
    expect(fn(...args)).toBe(expected);
  });

  it('parseInt-coerces stringy indices', () => {
    expect(_clipPath('0', '1')).toBe('live_set tracks 0 clip_slots 1 clip');
  });
});

describe('_dictReturnToJson', () => {
  it('returns the input as-is when it already starts with "{"', () => {
    expect(_dictReturnToJson('{"notes":[]}')).toBe('{"notes":[]}');
  });

  it('binds an array (last element is dict name) and stringifies', () => {
    // Stub Dict to return the predictable JSON string.
    const original = global.Dict;
    global.Dict = function (name) {
      return { stringify: () => `dict[${name}]` };
    };
    try {
      expect(_dictReturnToJson(['ignored', 'my_dict'])).toBe('dict[my_dict]');
    } finally {
      global.Dict = original;
    }
  });

  it('binds a scalar dict name', () => {
    const original = global.Dict;
    global.Dict = function (name) {
      return { stringify: () => `solo[${name}]` };
    };
    try {
      expect(_dictReturnToJson('foo')).toBe('solo[foo]');
    } finally {
      global.Dict = original;
    }
  });
});

describe('_ioListProp', () => {
  it.each([
    ['audio_in', 'audio_inputs'],
    ['audio_out', 'audio_outputs'],
    ['midi_in', 'midi_inputs'],
    ['midi_out', 'midi_outputs'],
  ])('maps %s → %s', (input, expected) => {
    expect(_ioListProp(input)).toBe(expected);
  });

  it('returns null for unknown tokens', () => {
    expect(_ioListProp('nope')).toBeNull();
  });
});

describe('_byId', () => {
  it('returns null for falsy / zero / "0" inputs', () => {
    expect(_byId(0)).toBeNull();
    expect(_byId('0')).toBeNull();
    expect(_byId(undefined)).toBeNull();
    expect(_byId(null)).toBeNull();
  });

  it('constructs a LiveAPI for valid ids', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ kind: 'liveapi-stub' }));
    try {
      expect(_byId(42)).toEqual({ kind: 'liveapi-stub' });
      expect(global.LiveAPI).toHaveBeenCalledWith(null, 'id', 42);
    } finally {
      global.LiveAPI = original;
    }
  });
});

describe('_resolveChildId', () => {
  function fakeParent(idsForKey) {
    return { get: (key) => idsForKey[key] };
  }

  it('returns the id at the right pair index', () => {
    const parent = fakeParent({ tracks: ['id', 11, 'id', 22, 'id', 33] });
    expect(_resolveChildId(parent, 'tracks', 1)).toBe(22);
  });

  it('returns 0 when the index is out of range', () => {
    const parent = fakeParent({ tracks: ['id', 11] });
    expect(_resolveChildId(parent, 'tracks', 5)).toBe(0);
  });

  it('returns 0 when the parent has no children', () => {
    const parent = fakeParent({ tracks: undefined });
    expect(_resolveChildId(parent, 'tracks', 0)).toBe(0);
  });

  it('returns 0 when the pair shape is wrong', () => {
    const parent = fakeParent({ tracks: ['weird', 11] });
    expect(_resolveChildId(parent, 'tracks', 0)).toBe(0);
  });
});

describe('_foreachChild', () => {
  it('iterates each id-pair and skips zero ids', () => {
    const original = global.LiveAPI;
    global.LiveAPI = function () {
      return { kind: 'liveapi-stub' };
    };
    try {
      const parent = { get: () => ['id', 11, 'id', 0, 'id', 22] };
      const seen = [];
      _foreachChild(parent, 'tracks', (api, idx) => {
        seen.push(idx);
      });
      // Idx 1 (id=0) was skipped.
      expect(seen).toEqual([0, 2]);
    } finally {
      global.LiveAPI = original;
    }
  });

  it('breaks early when fn returns false', () => {
    const original = global.LiveAPI;
    global.LiveAPI = function () {
      return {};
    };
    try {
      const parent = { get: () => ['id', 11, 'id', 22, 'id', 33] };
      const seen = [];
      _foreachChild(parent, 'tracks', (api, idx) => {
        seen.push(idx);
        if (idx === 0) return false;
      });
      expect(seen).toEqual([0]);
    } finally {
      global.LiveAPI = original;
    }
  });

  it('handles missing child list (defaults to [])', () => {
    const parent = { get: () => undefined };
    expect(() => _foreachChild(parent, 'tracks', () => {})).not.toThrow();
  });
});

describe('_resolveCueId', () => {
  it('builds a Song LiveAPI and resolves cue_points[idx]', () => {
    const original = global.LiveAPI;
    global.LiveAPI = function (_callback, _path) {
      // Return a parent whose get('cue_points') yields ['id', 99].
      return { get: () => ['id', 99] };
    };
    try {
      expect(_resolveCueId(0)).toBe(99);
    } finally {
      global.LiveAPI = original;
    }
  });
});

describe('_unwrap', () => {
  it('returns the last element of an array', () => {
    expect(_unwrap([1, 2, 3])).toBe(3);
  });
  it('returns the input as-is when not an array', () => {
    expect(_unwrap(42)).toBe(42);
    expect(_unwrap('x')).toBe('x');
  });
  it('returns undefined for empty arrays', () => {
    expect(_unwrap([])).toBeUndefined();
  });
});
