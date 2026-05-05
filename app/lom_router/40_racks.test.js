'use strict';

const racks = require('./40_racks');
const {
  _readChain,
  lom_get_rack_chains,
  lom_get_drum_pads,
  lom_get_chain_devices,
  lom_get_drum_pad_chains,
  lom_get_drum_pad_chain_devices,
  _readDeviceParams,
  lom_get_chain_device_params,
  lom_get_drum_pad_chain_device_params,
  lom_get_rack_macros,
  _rackCall,
  lom_add_rack_macro,
  lom_remove_rack_macro,
  lom_randomize_rack_macros,
  lom_store_rack_variation,
  lom_recall_last_used_variation,
  lom_delete_rack_variation,
  lom_recall_rack_variation,
  lom_insert_rack_chain,
  lom_copy_drum_pad,
  lom_set_drum_chain_props,
} = racks;

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

function lastResponse() {
  return outlet.mock.calls.at(-1);
}

describe('_readChain', () => {
  it('returns chain props with proper coercions', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 1 chains 2') {
        return {
          get: (key) => {
            const map = {
              name: 'Lead',
              color: 16711680,
              mute: [1],
              solo: [0],
              muted_via_solo: [1],
              has_audio_input: [0],
              has_audio_output: [1],
              has_midi_input: [1],
              has_midi_output: [0],
            };
            return map[key];
          },
        };
      }
    });
    try {
      const c = _readChain('live_set tracks 0 devices 1 chains 2', 2);
      expect(c).toEqual({
        chain_idx: 2,
        name: 'Lead',
        color: 16711680,
        mute: true,
        solo: false,
        muted_via_solo: true,
        has_audio_input: false,
        has_audio_output: true,
        has_midi_input: true,
        has_midi_output: false,
      });
    } finally {
      restore();
    }
  });

  it('coerces falsy/missing name to empty string', () => {
    const { restore } = patchLiveAPI(() => ({ get: () => null }));
    try {
      const c = _readChain('whatever', 0);
      expect(c.name).toBe('');
    } finally {
      restore();
    }
  });
});

describe('lom_get_rack_chains', () => {
  it('iterates and serializes chains as JSON', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 1') {
        return { getcount: () => 2 };
      }
      if (path && path.startsWith('live_set tracks 0 devices 1 chains ')) {
        const idx = parseInt(path.split(' ').at(-1));
        return {
          get: (key) => {
            if (key === 'name') return 'C' + idx;
            if (key === 'color') return 0;
            return [0];
          },
        };
      }
    });
    try {
      lom_get_rack_chains(7, 0, 1);
      const last = lastResponse();
      expect(last[3]).toBe('ok');
      const arr = JSON.parse(last[4]);
      expect(arr).toHaveLength(2);
      expect(arr[0].chain_idx).toBe(0);
      expect(arr[1].name).toBe('C1');
    } finally {
      restore();
    }
  });
});

describe('lom_get_drum_pads', () => {
  it('lists drum_pads (full) skipping pads with note < 0 or NaN', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 1 devices 0') {
        return { getcount: (k) => (k === 'drum_pads' ? 3 : 0) };
      }
      if (path === 'live_set tracks 1 devices 0 drum_pads 0') {
        return { get: () => [-1], getcount: () => 0 };
      }
      if (path === 'live_set tracks 1 devices 0 drum_pads 1') {
        return {
          get: (k) => {
            if (k === 'note') return [36];
            if (k === 'name') return 'Kick';
            if (k === 'mute') return [0];
            if (k === 'solo') return [1];
            return null;
          },
          getcount: () => 2,
        };
      }
      if (path === 'live_set tracks 1 devices 0 drum_pads 2') {
        return {
          get: (k) => (k === 'note' ? ['NaN'] : null),
          getcount: () => 0,
        };
      }
    });
    try {
      lom_get_drum_pads(1, 1, 0, 0);
      const arr = JSON.parse(lastResponse()[4]);
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({
        pad_idx: 36,
        name: 'Kick',
        note: 36,
        mute: false,
        solo: true,
        chain_count: 2,
      });
    } finally {
      restore();
    }
  });

  it('lists visible_drum_pads when onlyVisible=1', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 0') {
        return { getcount: (k) => (k === 'visible_drum_pads' ? 1 : 0) };
      }
      if (path === 'live_set tracks 0 devices 0 visible_drum_pads 0') {
        return {
          get: (k) => {
            if (k === 'note') return [60];
            if (k === 'name') return 'Visible';
            if (k === 'mute') return [0];
            if (k === 'solo') return [0];
            return null;
          },
          getcount: () => 0,
        };
      }
    });
    try {
      lom_get_drum_pads(1, 0, 0, 1);
      const arr = JSON.parse(lastResponse()[4]);
      expect(arr).toEqual([
        {
          pad_idx: 60,
          name: 'Visible',
          note: 60,
          mute: false,
          solo: false,
          chain_count: 0,
        },
      ]);
    } finally {
      restore();
    }
  });

  it('coerces falsy name to empty string', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 0') {
        return { getcount: () => 1 };
      }
      if (path === 'live_set tracks 0 devices 0 drum_pads 0') {
        return {
          get: (k) => {
            if (k === 'note') return [50];
            if (k === 'mute') return [0];
            if (k === 'solo') return [0];
            return null;
          },
          getcount: () => 0,
        };
      }
    });
    try {
      lom_get_drum_pads(1, 0, 0, 0);
      const arr = JSON.parse(lastResponse()[4]);
      expect(arr[0].name).toBe('');
    } finally {
      restore();
    }
  });
});

describe('lom_get_chain_devices', () => {
  it('returns each device with index/name/class_name', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 1 chains 0') {
        return { getcount: () => 2 };
      }
      if (path === 'live_set tracks 0 devices 1 chains 0 devices 0') {
        return {
          get: (k) => (k === 'name' ? 'Reverb' : 'AudioEffectGroup'),
        };
      }
      if (path === 'live_set tracks 0 devices 1 chains 0 devices 1') {
        return { get: () => null };
      }
    });
    try {
      lom_get_chain_devices(1, 0, 1, 0);
      const arr = JSON.parse(lastResponse()[4]);
      expect(arr[0]).toEqual({ index: 0, name: 'Reverb', class_name: 'AudioEffectGroup' });
      expect(arr[1]).toEqual({ index: 1, name: '', class_name: '' });
    } finally {
      restore();
    }
  });
});

describe('lom_get_drum_pad_chains', () => {
  it('returns chain props for nested drum-pad chains', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 0 drum_pads 36') {
        return { getcount: () => 1 };
      }
      if (path === 'live_set tracks 0 devices 0 drum_pads 36 chains 0') {
        return {
          get: (k) => {
            if (k === 'name') return 'Sub';
            if (k === 'mute') return [0];
            if (k === 'solo') return [0];
            if (k === 'in_note') return [36];
            if (k === 'out_note') return [36];
            if (k === 'choke_group') return [0];
            return null;
          },
        };
      }
    });
    try {
      lom_get_drum_pad_chains(1, 0, 0, 36);
      const arr = JSON.parse(lastResponse()[4]);
      expect(arr).toEqual([
        {
          chain_idx: 0,
          name: 'Sub',
          mute: false,
          solo: false,
          in_note: 36,
          out_note: 36,
          choke_group: 0,
        },
      ]);
    } finally {
      restore();
    }
  });

  it('coerces falsy name to empty string', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 0 drum_pads 36') {
        return { getcount: () => 1 };
      }
      return { get: () => null };
    });
    try {
      lom_get_drum_pad_chains(1, 0, 0, 36);
      const arr = JSON.parse(lastResponse()[4]);
      expect(arr[0].name).toBe('');
    } finally {
      restore();
    }
  });
});

describe('lom_get_drum_pad_chain_devices', () => {
  it('returns device list at depth 2', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 0 drum_pads 36 chains 0') {
        return { getcount: () => 1 };
      }
      if (path === 'live_set tracks 0 devices 0 drum_pads 36 chains 0 devices 0') {
        return { get: (k) => (k === 'name' ? 'Sampler' : 'Sampler') };
      }
    });
    try {
      lom_get_drum_pad_chain_devices(1, 0, 0, 36, 0);
      const arr = JSON.parse(lastResponse()[4]);
      expect(arr).toEqual([{ index: 0, name: 'Sampler', class_name: 'Sampler' }]);
    } finally {
      restore();
    }
  });

  it('coerces falsy name/class_name to empty strings', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 0 drum_pads 36 chains 0') {
        return { getcount: () => 1 };
      }
      if (path === 'live_set tracks 0 devices 0 drum_pads 36 chains 0 devices 0') {
        return { get: () => null };
      }
    });
    try {
      lom_get_drum_pad_chain_devices(1, 0, 0, 36, 0);
      const arr = JSON.parse(lastResponse()[4]);
      expect(arr[0]).toEqual({ index: 0, name: '', class_name: '' });
    } finally {
      restore();
    }
  });
});

describe('_readDeviceParams', () => {
  it('returns params with quantized value_items when applicable', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'dev') {
        return { getcount: () => 2 };
      }
      if (path === 'dev parameters 0') {
        return {
          get: (k) => {
            const map = {
              name: 'Cutoff',
              value: 0.5,
              min: 0,
              max: 1,
              is_quantized: [0],
              is_enabled: [1],
            };
            return map[k];
          },
        };
      }
      if (path === 'dev parameters 1') {
        return {
          get: (k) => {
            const map = {
              name: 'Mode',
              value: 1,
              min: 0,
              max: 2,
              is_quantized: [1],
              is_enabled: [1],
              value_items: ['LP', 'BP', 'HP'],
            };
            return map[k];
          },
        };
      }
    });
    try {
      const params = _readDeviceParams('dev');
      expect(params[0]).toEqual({
        index: 0,
        name: 'Cutoff',
        value: 0.5,
        min: 0,
        max: 1,
        is_quantized: false,
        is_enabled: true,
      });
      expect(params[1]).toMatchObject({
        index: 1,
        is_quantized: true,
        value_items: ['LP', 'BP', 'HP'],
      });
    } finally {
      restore();
    }
  });

  it('omits value_items when get returns non-array', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'dev') return { getcount: () => 1 };
      if (path === 'dev parameters 0') {
        return {
          get: (k) => {
            const map = {
              name: 'X',
              value: 0,
              min: 0,
              max: 1,
              is_quantized: [1],
              is_enabled: [1],
              value_items: 'oops-not-array',
            };
            return map[k];
          },
        };
      }
    });
    try {
      const params = _readDeviceParams('dev');
      expect(params[0]).not.toHaveProperty('value_items');
    } finally {
      restore();
    }
  });
});

describe('lom_get_chain_device_params', () => {
  it('reads params at chain device path', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 1 chains 2 devices 3') {
        return { getcount: () => 0 };
      }
    });
    try {
      lom_get_chain_device_params(1, 0, 1, 2, 3);
      expect(lastResponse()[3]).toBe('ok');
      expect(JSON.parse(lastResponse()[4])).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('lom_get_drum_pad_chain_device_params', () => {
  it('reads params at drum-pad chain device path', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 0 drum_pads 36 chains 0 devices 0') {
        return { getcount: () => 0 };
      }
    });
    try {
      lom_get_drum_pad_chain_device_params(1, 0, 0, 36, 0, 0);
      expect(JSON.parse(lastResponse()[4])).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('lom_get_rack_macros', () => {
  it('filters params keeping only those starting with "Macro " and bundles meta', () => {
    const { restore } = patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 1') {
        return {
          getcount: () => 3,
          get: (k) => {
            const map = {
              visible_macro_count: [4],
              variation_count: [2],
              selected_variation_index: [0],
              has_macro_mappings: [1],
            };
            return map[k];
          },
        };
      }
      if (path === 'live_set tracks 0 devices 1 parameters 0') {
        return {
          get: (k) => {
            const map = { name: 'Device On', value: 1, min: 0, max: 1 };
            return map[k];
          },
        };
      }
      if (path === 'live_set tracks 0 devices 1 parameters 1') {
        return {
          get: (k) => {
            const map = { name: 'Macro 1', value: 64, min: 0, max: 127 };
            return map[k];
          },
        };
      }
      if (path === 'live_set tracks 0 devices 1 parameters 2') {
        return {
          get: (k) => {
            const map = { name: null, value: 0, min: 0, max: 1 };
            return map[k];
          },
        };
      }
    });
    try {
      lom_get_rack_macros(1, 0, 1);
      const obj = JSON.parse(lastResponse()[4]);
      expect(obj.macros).toHaveLength(1);
      expect(obj.macros[0]).toEqual({
        index: 1,
        name: 'Macro 1',
        value: 64,
        min: 0,
        max: 127,
      });
      expect(obj.visible_macro_count).toBe(4);
      expect(obj.variation_count).toBe(2);
      expect(obj.has_macro_mappings).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('_rackCall + simple action wrappers', () => {
  function patchSpyingRack(spy) {
    return patchLiveAPI((path) => {
      if (path === 'live_set tracks 0 devices 1') return { call: spy };
    });
  }

  it('lom_add_rack_macro → call("add_macro")', () => {
    const spy = jest.fn();
    const { restore } = patchSpyingRack(spy);
    try {
      lom_add_rack_macro(1, 0, 1);
      expect(spy).toHaveBeenCalledWith('add_macro');
      expect(lastResponse()[4]).toBe('done');
    } finally {
      restore();
    }
  });

  it('lom_remove_rack_macro → call("remove_macro")', () => {
    const spy = jest.fn();
    const { restore } = patchSpyingRack(spy);
    try {
      lom_remove_rack_macro(1, 0, 1);
      expect(spy).toHaveBeenCalledWith('remove_macro');
    } finally {
      restore();
    }
  });

  it('lom_randomize_rack_macros → call("randomize_macros")', () => {
    const spy = jest.fn();
    const { restore } = patchSpyingRack(spy);
    try {
      lom_randomize_rack_macros(1, 0, 1);
      expect(spy).toHaveBeenCalledWith('randomize_macros');
    } finally {
      restore();
    }
  });

  it('lom_store_rack_variation → call("store_variation")', () => {
    const spy = jest.fn();
    const { restore } = patchSpyingRack(spy);
    try {
      lom_store_rack_variation(1, 0, 1);
      expect(spy).toHaveBeenCalledWith('store_variation');
    } finally {
      restore();
    }
  });

  it('lom_recall_last_used_variation → call("recall_last_used_variation")', () => {
    const spy = jest.fn();
    const { restore } = patchSpyingRack(spy);
    try {
      lom_recall_last_used_variation(1, 0, 1);
      expect(spy).toHaveBeenCalledWith('recall_last_used_variation');
    } finally {
      restore();
    }
  });

  it('lom_delete_rack_variation → call("delete_selected_variation")', () => {
    const spy = jest.fn();
    const { restore } = patchSpyingRack(spy);
    try {
      lom_delete_rack_variation(1, 0, 1);
      expect(spy).toHaveBeenCalledWith('delete_selected_variation');
    } finally {
      restore();
    }
  });

  it('exposed _rackCall directly outlets done with arbitrary method name', () => {
    const spy = jest.fn();
    const { restore } = patchSpyingRack(spy);
    try {
      _rackCall(2, 0, 1, 'whatever');
      expect(spy).toHaveBeenCalledWith('whatever');
      expect(lastResponse()).toEqual([0, 'lom_response', 2, 'ok', 'done']);
    } finally {
      restore();
    }
  });
});

describe('lom_recall_rack_variation', () => {
  it('sets selected_variation_index when idx >= 0 then recalls', () => {
    const setSpy = jest.fn();
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ set: setSpy, call: callSpy }));
    try {
      lom_recall_rack_variation(1, 0, 1, 3);
      expect(setSpy).toHaveBeenCalledWith('selected_variation_index', 3);
      expect(callSpy).toHaveBeenCalledWith('recall_selected_variation');
      expect(lastResponse()[4]).toBe('done');
    } finally {
      restore();
    }
  });

  it('skips set when idx < 0', () => {
    const setSpy = jest.fn();
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ set: setSpy, call: callSpy }));
    try {
      lom_recall_rack_variation(1, 0, 1, -1);
      expect(setSpy).not.toHaveBeenCalled();
      expect(callSpy).toHaveBeenCalledWith('recall_selected_variation');
    } finally {
      restore();
    }
  });
});

describe('lom_insert_rack_chain', () => {
  it('calls insert_chain (no arg) when position is negative', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_insert_rack_chain(1, 0, 1, -1);
      expect(callSpy).toHaveBeenCalledWith('insert_chain');
    } finally {
      restore();
    }
  });

  it('calls insert_chain (no arg) when position is NaN', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_insert_rack_chain(1, 0, 1, 'not-a-number');
      expect(callSpy).toHaveBeenCalledWith('insert_chain');
    } finally {
      restore();
    }
  });

  it('calls insert_chain with parsed positional arg when valid', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_insert_rack_chain(1, 0, 1, 2);
      expect(callSpy).toHaveBeenCalledWith('insert_chain', 2);
    } finally {
      restore();
    }
  });
});

describe('lom_copy_drum_pad', () => {
  it('calls copy_pad with parsed source/dest', () => {
    const callSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ call: callSpy }));
    try {
      lom_copy_drum_pad(1, 0, 1, '36', '37');
      expect(callSpy).toHaveBeenCalledWith('copy_pad', 36, 37);
      expect(lastResponse()[4]).toBe('done');
    } finally {
      restore();
    }
  });
});

describe('lom_set_drum_chain_props', () => {
  it('sets all three fields when valid', () => {
    const setSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ set: setSpy }));
    try {
      lom_set_drum_chain_props(1, 0, 0, 36, 0, 60, 60, 1);
      expect(setSpy).toHaveBeenCalledWith('in_note', 60);
      expect(setSpy).toHaveBeenCalledWith('out_note', 60);
      expect(setSpy).toHaveBeenCalledWith('choke_group', 1);
    } finally {
      restore();
    }
  });

  it('skips fields with -999 sentinel and NaN', () => {
    const setSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ set: setSpy }));
    try {
      lom_set_drum_chain_props(1, 0, 0, 36, 0, -999, 'NaN', 2);
      expect(setSpy).not.toHaveBeenCalledWith('in_note', expect.anything());
      expect(setSpy).not.toHaveBeenCalledWith('out_note', expect.anything());
      expect(setSpy).toHaveBeenCalledWith('choke_group', 2);
      expect(lastResponse()[4]).toBe('done');
    } finally {
      restore();
    }
  });

  it('skips all three fields when all sentinels', () => {
    const setSpy = jest.fn();
    const { restore } = patchLiveAPI(() => ({ set: setSpy }));
    try {
      lom_set_drum_chain_props(1, 0, 0, 36, 0, -999, -999, -999);
      expect(setSpy).not.toHaveBeenCalled();
      expect(lastResponse()[4]).toBe('done');
    } finally {
      restore();
    }
  });
});
