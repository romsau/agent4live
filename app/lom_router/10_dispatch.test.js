'use strict';

const dispatch = require('./10_dispatch');
const { lom_request, lom_scan_peers, lom_session_state } = dispatch;

beforeEach(() => {
  outlet.mockClear();
});

describe('lom_request', () => {
  it('get → returns _unwrap(api.get(prop))', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      get: () => [120],
    }));
    try {
      // (id=1, op=get, nParts=1, "live_set", prop="tempo")
      lom_request(1, 'get', 1, 'live_set', 'tempo');
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet).toEqual([0, 'lom_response', 1, 'ok', 120]);
  });

  it('set → calls api.set, returns "done"', () => {
    const setSpy = jest.fn();
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ set: setSpy }));
    try {
      lom_request(1, 'set', 1, 'live_set', 'tempo', 130);
    } finally {
      global.LiveAPI = original;
    }
    expect(setSpy).toHaveBeenCalledWith('tempo', 130);
    expect(outlet.mock.calls.at(-1)[4]).toBe('done');
  });

  it('call without args → returns api.call(prop) result', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({
      call: () => 'done-by-live',
    }));
    try {
      lom_request(1, 'call', 1, 'live_set', 'start_playing');
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[4]).toBe('done-by-live');
  });

  it('call with args → forwards them via apply', () => {
    const callSpy = jest.fn(() => 'ok');
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ call: callSpy }));
    try {
      lom_request(1, 'call', 1, 'live_set', 'jump_by', 4, 'extra');
    } finally {
      global.LiveAPI = original;
    }
    expect(callSpy).toHaveBeenCalledWith('jump_by', 4, 'extra');
  });

  it('call → returns "done" when api.call returns undefined', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ call: () => undefined }));
    try {
      lom_request(1, 'call', 1, 'live_set', 'whatever');
    } finally {
      global.LiveAPI = original;
    }
    expect(outlet.mock.calls.at(-1)[4]).toBe('done');
  });

  it('throws on unsupported op', () => {
    lom_request(1, 'bogus', 1, 'live_set', 'tempo');
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('error');
    expect(lastOutlet[4]).toMatch(/unsupported op: bogus/);
  });

  it('joins multi-segment paths via space-separated parts', () => {
    let capturedPath;
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, path) => {
      capturedPath = path;
      return { get: () => 1 };
    });
    try {
      lom_request(1, 'get', 3, 'live_set', 'tracks', '0', 'name');
    } finally {
      global.LiveAPI = original;
    }
    expect(capturedPath).toBe('live_set tracks 0');
  });
});

describe('lom_scan_peers', () => {
  it('finds peers with the marker parameter on tracks/returns/master and reports isSelf correctly', () => {
    const SELF_DEV_ID = 100;
    const PEER_DEV_ID = 200;
    const RETURN_DEV_ID = 300;
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      const path = args[0];
      if (path === 'this_device') return { id: SELF_DEV_ID };
      if (path === 'live_set') {
        return {
          get: (key) => {
            if (key === 'tracks') return ['id', 1];
            if (key === 'return_tracks') return ['id', 2];
            return [];
          },
        };
      }
      if (path === 'live_set master_track') {
        return {
          get: (key) => {
            if (key === 'devices') return ['id', SELF_DEV_ID];
            if (key === 'name') return 'Master';
            if (key === 'parameters') return ['id', 999];
            return [];
          },
        };
      }
      if (args[0] === 'id') {
        const idValue = args[1];
        if (idValue === 1) {
          return {
            get: (key) => {
              if (key === 'name') return 'Track 1';
              if (key === 'devices') return ['id', PEER_DEV_ID];
              return [];
            },
          };
        }
        if (idValue === 2) {
          return {
            get: (key) => {
              if (key === 'name') return 'Return A';
              if (key === 'devices') return ['id', RETURN_DEV_ID];
              return [];
            },
          };
        }
        if (idValue === SELF_DEV_ID || idValue === PEER_DEV_ID || idValue === RETURN_DEV_ID) {
          return {
            id: idValue,
            get: (key) => (key === 'parameters' ? ['id', 999] : []),
          };
        }
        if (idValue === 999) {
          return {
            id: 999,
            get: (key) => (key === 'name' ? '__agent4live_marker__' : ''),
          };
        }
      }
      return { get: () => [] };
    });
    try {
      lom_scan_peers(1);
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('ok');
    const result = JSON.parse(lastOutlet[4]);
    expect(result.selfId).toBe(SELF_DEV_ID);
    expect(result.peers).toHaveLength(3);
    const self = result.peers.find((p) => p.isSelf);
    expect(self).toBeDefined();
    expect(self.deviceId).toBe(SELF_DEV_ID);
    expect(result.peers.map((p) => p.trackName).sort()).toEqual(['Master', 'Return A', 'Track 1']);
  });

  it('inner param scan continues when name does not match marker', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      const path = args[0];
      if (path === 'this_device') return { id: 1 };
      if (path === 'live_set') {
        return { get: () => [] };
      }
      if (path === 'live_set master_track') {
        return { get: (key) => (key === 'devices' ? ['id', 5] : key === 'name' ? 'M' : []) };
      }
      if (path === 'id') {
        const idVal = args[1];
        if (idVal === 5) return { id: 5, get: () => ['id', 7, 'id', 8] };
        if (idVal === 7) return { id: 7, get: () => 'not-marker' };
        if (idVal === 8) return { id: 8, get: () => 'not-marker' };
      }
      return { get: () => [] };
    });
    try {
      lom_scan_peers(1);
    } finally {
      global.LiveAPI = original;
    }
    const result = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(result.peers).toEqual([]);
  });
});

describe('lom_session_state', () => {
  it('outlets snapshot with tempo, is_playing, tracks and scenes', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, ...args) => {
      const path = args[0];
      if (path === 'live_set') {
        return {
          get: (key) => {
            if (key === 'tempo') return [120];
            if (key === 'is_playing') return [1];
            if (key === 'tracks') return ['id', 11];
            if (key === 'scenes') return ['id', 22];
            return [];
          },
        };
      }
      if (args[0] === 'id') {
        const idVal = args[1];
        if (idVal === 11) {
          return {
            get: (key) => {
              if (key === 'name') return 'Drums';
              if (key === 'is_midi_track') return [1];
              if (key === 'mute') return [0];
              return null;
            },
          };
        }
        if (idVal === 22) {
          return { get: (key) => (key === 'name' ? 'Verse' : null) };
        }
      }
      return { get: () => null };
    });
    try {
      lom_session_state(1);
    } finally {
      global.LiveAPI = original;
    }
    const result = JSON.parse(outlet.mock.calls.at(-1)[4]);
    expect(result.tempo).toBe(120);
    expect(result.is_playing).toBe(true);
    expect(result.tracks).toEqual([{ index: 0, name: 'Drums', is_midi_track: true, muted: false }]);
    expect(result.scenes).toEqual([{ index: 0, name: 'Verse' }]);
    expect(result.track_count).toBe(1);
    expect(result.scene_count).toBe(1);
  });
});
