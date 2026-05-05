'use strict';

const { lom_set_track_routing, lom_get_track_routing } = require('./60_routing');

beforeEach(() => {
  outlet.mockClear();
});

/**
 * Build a fake Track LiveAPI for these tests. `props` maps prop name → return
 * value (what `track.get(prop)` will yield). `set` is a jest.fn() to assert
 * on the dict that the routing setter wrote.
 * @param props
 */
function fakeTrack(props) {
  const setSpy = jest.fn();
  const original = global.LiveAPI;
  global.LiveAPI = jest.fn().mockImplementation(() => ({
    get: (key) => props[key],
    set: setSpy,
  }));
  return {
    setSpy,
    restore: () => {
      global.LiveAPI = original;
    },
  };
}

describe('lom_set_track_routing', () => {
  it('matches the identifier and writes a Dict to the track', () => {
    const json = JSON.stringify({
      available_input_routing_types: [
        { identifier: 'ext-1', display_name: 'Ext. 1' },
        { identifier: 'no-input', display_name: 'No Input' },
      ],
    });
    const { setSpy, restore } = fakeTrack({ available_input_routing_types: json });
    try {
      lom_set_track_routing(1, 0, 'input_routing_type', 'no-input');
    } finally {
      restore();
    }
    // outlet ok with the matched JSON
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet.slice(0, 4)).toEqual([0, 'lom_response', 1, 'ok']);
    expect(JSON.parse(lastOutlet[4])).toEqual({
      identifier: 'no-input',
      display_name: 'No Input',
    });
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('outlets error with the available list when the identifier is missing', () => {
    const json = JSON.stringify({
      available_input_routing_types: [
        { identifier: 'A', display_name: 'Alpha' },
        { identifier: 'B', display_name: 'Beta' },
      ],
    });
    const { restore } = fakeTrack({ available_input_routing_types: json });
    try {
      lom_set_track_routing(2, 0, 'input_routing_type', 'unknown');
    } finally {
      restore();
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet.slice(0, 4)).toEqual([0, 'lom_response', 2, 'error']);
    expect(lastOutlet[4]).toContain('No input_routing_type with identifier "unknown"');
    expect(lastOutlet[4]).toContain('"A" (Alpha)');
    expect(lastOutlet[4]).toContain('"B" (Beta)');
  });

  it('handles single-element-array wrapping (Live quirk)', () => {
    const json = JSON.stringify({
      available_input_routing_types: [{ identifier: 'A', display_name: 'A' }],
    });
    const { setSpy, restore } = fakeTrack({ available_input_routing_types: [json] });
    try {
      lom_set_track_routing(3, 0, 'input_routing_type', 'A');
    } finally {
      restore();
    }
    expect(setSpy).toHaveBeenCalled();
  });

  it('treats non-JSON-envelope avail as empty (no match → throws)', () => {
    const { restore } = fakeTrack({ available_input_routing_types: 'not-json' });
    try {
      lom_set_track_routing(4, 0, 'input_routing_type', 'X');
    } finally {
      restore();
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('error');
  });

  it('falls through gracefully when the JSON envelope is malformed', () => {
    const { restore } = fakeTrack({
      available_input_routing_types: '{not valid json',
    });
    try {
      lom_set_track_routing(5, 0, 'input_routing_type', 'X');
    } finally {
      restore();
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('error');
  });

  it('defaults avail to [] when the JSON envelope is missing the expected key', () => {
    // covers `parsed[availName] || []` falsy branch
    const json = JSON.stringify({ unrelated: [] });
    const { restore } = fakeTrack({ available_input_routing_types: json });
    try {
      lom_set_track_routing(6, 0, 'input_routing_type', 'X');
    } finally {
      restore();
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('error');
  });
});

describe('lom_get_track_routing', () => {
  it('reads JSON-envelope props for input side, unwrapping the prop name key', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => {
        if (key === 'input_routing_type')
          return JSON.stringify({ input_routing_type: { id: 'A' } });
        if (key === 'available_input_routing_types')
          return JSON.stringify({ available_input_routing_types: [{ id: 'A' }] });
        if (key === 'input_routing_channel')
          return JSON.stringify({ input_routing_channel: { id: 'L' } });
        if (key === 'available_input_routing_channels')
          return JSON.stringify({ available_input_routing_channels: [{ id: 'L' }] });
        return null;
      },
    }));
    try {
      lom_get_track_routing(1, 0, 'input');
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('ok');
    const result = JSON.parse(lastOutlet[4]);
    expect(result.type.current).toEqual({ id: 'A' });
    expect(result.channel.current).toEqual({ id: 'L' });
  });

  it('falls back to alternating-list parsing for older Live versions', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) => {
        if (key === 'output_routing_type') return ['identifier', 'A', 'display_name', 'AAA'];
        return null;
      },
    }));
    try {
      lom_get_track_routing(1, 0, 'output');
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(JSON.parse(lastOutlet[4]).type.current).toEqual({
      identifier: 'A',
      display_name: 'AAA',
    });
  });

  it('falls back to scalar value when neither JSON envelope nor list', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: () => 42,
    }));
    try {
      lom_get_track_routing(1, 0, 'output');
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(JSON.parse(lastOutlet[4]).type.current).toBe(42);
  });

  it('falls through when the JSON envelope is malformed', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: () => '{malformed',
    }));
    try {
      lom_get_track_routing(1, 0, 'output');
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(JSON.parse(lastOutlet[4]).type.current).toBe('{malformed');
  });

  it('returns parsed envelope when prop key is absent', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: () => JSON.stringify({ unrelated: 'value' }),
    }));
    try {
      lom_get_track_routing(1, 0, 'output');
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(JSON.parse(lastOutlet[4]).type.current).toEqual({ unrelated: 'value' });
  });

  it('unwraps single-element-array JSON envelope (Live quirk)', () => {
    // covers the `Array.isArray(raw) && raw.length === 1 ? raw[0] : raw` true branch
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: (key) =>
        key === 'output_routing_type'
          ? [JSON.stringify({ output_routing_type: { id: 'X' } })]
          : null,
    }));
    try {
      lom_get_track_routing(1, 0, 'output');
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(JSON.parse(lastOutlet[4]).type.current).toEqual({ id: 'X' });
  });
});
