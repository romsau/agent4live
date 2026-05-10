'use strict';

const devices = require('./30_devices');
const {
  _unwrapDictProp,
  lom_get_device_io_routings,
  lom_set_device_io_routing_type,
  lom_set_device_io_routing_channel,
  lom_get_track_devices,
  lom_get_device_params,
  lom_move_device,
  lom_select_device,
} = devices;

beforeEach(() => {
  outlet.mockClear();
});

describe('_unwrapDictProp', () => {
  it('unwraps single-element-array JSON envelope', () => {
    const api = {
      get: () => [JSON.stringify({ routing_type: { id: 'A' } })],
    };
    expect(_unwrapDictProp(api, 'routing_type')).toEqual({ id: 'A' });
  });

  it('unwraps direct JSON envelope', () => {
    const api = {
      get: () => JSON.stringify({ routing_type: { id: 'B' } }),
    };
    expect(_unwrapDictProp(api, 'routing_type')).toEqual({ id: 'B' });
  });

  it('returns parsed object when key is absent in envelope', () => {
    const api = { get: () => JSON.stringify({ unrelated: 1 }) };
    expect(_unwrapDictProp(api, 'routing_type')).toEqual({ unrelated: 1 });
  });

  it('falls through alternating-list to object', () => {
    const api = { get: () => ['identifier', 'A', 'display_name', 'AAA'] };
    expect(_unwrapDictProp(api, 'routing_type')).toEqual({
      identifier: 'A',
      display_name: 'AAA',
    });
  });

  it('returns scalar when neither envelope nor list', () => {
    const api = { get: () => 42 };
    expect(_unwrapDictProp(api, 'routing_type')).toBe(42);
  });

  it('falls through when JSON envelope is malformed', () => {
    const api = { get: () => '{malformed' };
    // String fallthrough returns the val (the string itself).
    expect(_unwrapDictProp(api, 'routing_type')).toBe('{malformed');
  });
});

describe('lom_get_device_io_routings', () => {
  it('outlets per-bus arrays + per-IO type/channel', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, path) => {
      if (path === 'live_set tracks 0 devices 0') {
        return {
          getcount: (listProp) => (listProp === 'audio_inputs' ? 1 : 0),
        };
      }
      // io path
      return {
        get: (key) => {
          if (key === 'routing_type') return JSON.stringify({ routing_type: { id: 'in1' } });
          if (key === 'routing_channel') return JSON.stringify({ routing_channel: { id: 'L' } });
          if (key === 'available_routing_types')
            return JSON.stringify({ available_routing_types: [{ id: 'in1' }] });
          if (key === 'available_routing_channels')
            return JSON.stringify({ available_routing_channels: [{ id: 'L' }] });
          return null;
        },
      };
    });
    try {
      lom_get_device_io_routings(1, 0, 0);
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('ok');
    const result = JSON.parse(lastOutlet[4]);
    expect(result.audio_inputs).toHaveLength(1);
    expect(result.audio_inputs[0]).toEqual({
      index: 0,
      routing_type: { id: 'in1' },
      routing_channel: { id: 'L' },
      available_types: [{ id: 'in1' }],
      available_channels: [{ id: 'L' }],
    });
    expect(result.audio_outputs).toEqual([]);
  });

  it('returns null for a list when getcount throws', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      getcount: () => {
        throw new Error('no list');
      },
    }));
    try {
      lom_get_device_io_routings(1, 0, 0);
    } finally {
      global.LiveAPI = original;
    }
    const result = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(result.audio_inputs).toBeNull();
  });
});

describe('lom_set_device_io_routing_type / _channel', () => {
  function makeIoApi(props, setSpy) {
    return {
      get: (key) => props[key],
      set: setSpy,
    };
  }

  it('outlets error on invalid io_type', () => {
    lom_set_device_io_routing_type(1, 0, 0, 'bogus_type', 0, 'X');
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('error');
    expect(lastOutlet[4]).toMatch(/invalid io_type/);
  });

  it('matches identifier and writes Dict, returns matched JSON', () => {
    const setSpy = jest.fn();
    const original = global.LiveAPI;
    const ioJson = JSON.stringify({
      available_routing_types: [{ identifier: 'in1', display_name: 'In 1' }],
    });
    global.LiveAPI = jest
      .fn()
      .mockImplementation(() => makeIoApi({ available_routing_types: ioJson }, setSpy));
    try {
      lom_set_device_io_routing_type(1, 0, 0, 'audio_in', 0, 'in1');
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('ok');
    expect(JSON.parse(lastOutlet[4])).toEqual({ identifier: 'in1', display_name: 'In 1' });
    expect(setSpy).toHaveBeenCalled();
  });

  it('throws when identifier not found, lists available', () => {
    const original = global.LiveAPI;
    const ioJson = JSON.stringify({
      available_routing_types: [{ identifier: 'A', display_name: 'Alpha' }],
    });
    global.LiveAPI = jest.fn().mockImplementation(() => ({ get: () => ioJson }));
    try {
      lom_set_device_io_routing_type(1, 0, 0, 'audio_in', 0, 'unknown');
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('error');
    expect(lastOutlet[4]).toContain('"A" (Alpha)');
  });

  it('handles single-element-array wrapping', () => {
    const setSpy = jest.fn();
    const original = global.LiveAPI;
    const ioJson = JSON.stringify({
      available_routing_types: [{ identifier: 'A', display_name: 'A' }],
    });
    global.LiveAPI = jest
      .fn()
      .mockImplementation(() => makeIoApi({ available_routing_types: [ioJson] }, setSpy));
    try {
      lom_set_device_io_routing_type(1, 0, 0, 'audio_in', 0, 'A');
    } finally {
      global.LiveAPI = original;
    }
    expect(setSpy).toHaveBeenCalled();
  });

  it('falls through when JSON envelope is malformed', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: () => '{malformed',
    }));
    try {
      lom_set_device_io_routing_type(1, 0, 0, 'audio_in', 0, 'X');
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });

  it('defaults avail to [] when JSON envelope is missing the expected key', () => {
    const original = global.LiveAPI;
    const ioJson = JSON.stringify({ unrelated: [] });
    global.LiveAPI = jest.fn().mockImplementation(() => ({ get: () => ioJson }));
    try {
      lom_set_device_io_routing_type(1, 0, 0, 'audio_in', 0, 'X');
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });

  it('lom_set_device_io_routing_channel forwards to the same helper with prop=routing_channel', () => {
    const setSpy = jest.fn();
    const original = global.LiveAPI;
    const ioJson = JSON.stringify({
      available_routing_channels: [{ identifier: 'L', display_name: 'L' }],
    });
    global.LiveAPI = jest
      .fn()
      .mockImplementation(() => makeIoApi({ available_routing_channels: ioJson }, setSpy));
    try {
      lom_set_device_io_routing_channel(1, 0, 0, 'audio_in', 0, 'L');
    } finally {
      global.LiveAPI = original;
    }
    expect(setSpy).toHaveBeenCalledWith('routing_channel', expect.any(Object));
  });

  it('non-string availStr falls through (Live returned an array of objects)', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      // not a string envelope, not a single-element array — bypasses both branches
      get: () => [{ identifier: 'A' }, { identifier: 'B' }],
    }));
    try {
      lom_set_device_io_routing_type(1, 0, 0, 'audio_in', 0, 'X');
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
  });
});

describe('lom_get_track_devices', () => {
  it('outlets JSON of devices', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, path) => {
      if (path === 'live_set tracks 0') {
        return { getcount: () => 2 };
      }
      // devices N
      const idx = path.match(/devices (\d+)$/)[1];
      return {
        get: (key) => (key === 'name' ? `D${idx}` : `Class${idx}`),
      };
    });
    try {
      lom_get_track_devices(1, 0);
    } finally {
      global.LiveAPI = original;
    }
    const result = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(result).toEqual([
      { index: 0, name: 'D0', class_name: 'Class0' },
      { index: 1, name: 'D1', class_name: 'Class1' },
    ]);
  });
});

describe('lom_get_device_params', () => {
  it('outlets JSON with value_items only on quantized params', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, path) => {
      if (path === 'live_set tracks 0 devices 0') return { getcount: () => 2 };
      const idx = parseInt(path.match(/parameters (\d+)$/)[1], 10);
      return {
        get: (key) => {
          if (key === 'name') return `P${idx}`;
          if (key === 'value') return idx;
          if (key === 'min') return 0;
          if (key === 'max') return 1;
          if (key === 'is_quantized') return idx === 0 ? 1 : 0;
          if (key === 'is_enabled') return 1;
          if (key === 'value_items') return idx === 0 ? ['a', 'b'] : null;
          return null;
        },
      };
    });
    try {
      lom_get_device_params(1, 0, 0);
    } finally {
      global.LiveAPI = original;
    }
    const result = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(result[0].is_quantized).toBe(true);
    expect(result[0].value_items).toEqual(['a', 'b']);
    expect(result[1].is_quantized).toBe(false);
    expect(result[1].value_items).toBeUndefined();
  });

  it('skips value_items when value_items is not an array', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, path) => {
      if (path === 'live_set tracks 0 devices 0') return { getcount: () => 1 };
      return {
        get: (key) => {
          if (key === 'name') return 'P0';
          if (key === 'value') return 0;
          if (key === 'min') return 0;
          if (key === 'max') return 1;
          if (key === 'is_quantized') return 1;
          if (key === 'is_enabled') return 1;
          if (key === 'value_items') return 'not-an-array';
          return null;
        },
      };
    });
    try {
      lom_get_device_params(1, 0, 0);
    } finally {
      global.LiveAPI = original;
    }
    const result = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(result[0].value_items).toBeUndefined();
  });
});

describe('lom_move_device', () => {
  it('outlets ok and calls live_set move_device', () => {
    const callSpy = jest.fn();
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, path) => {
      if (path === 'live_set') return { call: callSpy };
      // src or dst — both have a non-zero id
      return { id: path === 'live_set tracks 0 devices 1' ? 11 : 22 };
    });
    try {
      lom_move_device(1, 0, 1, 1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('ok');
    expect(callSpy).toHaveBeenCalledWith('move_device', 'id', 11, 'id', 22, 0);
  });

  it('throws when source device id is missing', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ id: 0 }));
    try {
      lom_move_device(1, 0, 0, 1, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
    expect(outlet.mock.calls.at(-1)[4]).toMatch(/No device/);
  });

  it('throws when dst track id is missing', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, path) => {
      if (path.startsWith('live_set tracks 0 devices')) return { id: 11 };
      return { id: 0 }; // dst track not found
    });
    try {
      lom_move_device(1, 0, 0, 99, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
    expect(outlet.mock.calls.at(-1)[4]).toMatch(/No track/);
  });
});

describe('lom_select_device', () => {
  it('calls view.select_device with the resolved device id', () => {
    const callSpy = jest.fn();
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((_handler, path) => {
      if (path === 'live_set tracks 2 devices 1') return { id: 42 };
      if (path === 'live_set view') return { call: callSpy };
      return null;
    });
    try {
      lom_select_device(7, 2, 1);
    } finally {
      global.LiveAPI = original;
    }
    expect(callSpy).toHaveBeenCalledWith('select_device', 42);
    expect(outlet.mock.calls.at(-1)[3]).toBe('ok');
  });

  it('throws when device id is 0 (no device at index)', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ id: 0 }));
    try {
      lom_select_device(7, 0, 99);
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
    expect(outlet.mock.calls.at(-1)[4]).toMatch(/No device/);
  });

  it('throws when device id resolves to falsy string "0"', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ id: '0' }));
    try {
      lom_select_device(7, 0, 0);
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[3]).toBe('error');
    expect(outlet.mock.calls.at(-1)[4]).toMatch(/No device/);
  });
});
