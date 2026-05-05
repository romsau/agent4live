'use strict';

const observers = require('./50_observers');
const { _scheduleObserverFlush, _serializeForOutlet, lom_observe, lom_unobserve } = observers;

beforeEach(() => {
  outlet.mockClear();
});

describe('_serializeForOutlet', () => {
  it('returns "" for null and undefined', () => {
    expect(_serializeForOutlet(null)).toBe('');
    expect(_serializeForOutlet(undefined)).toBe('');
  });

  it('passes through scalars (number, boolean, string)', () => {
    expect(_serializeForOutlet(42)).toBe(42);
    expect(_serializeForOutlet(true)).toBe(true);
    expect(_serializeForOutlet('hi')).toBe('hi');
  });

  it('JSON-stringifies arrays and objects', () => {
    expect(_serializeForOutlet([1, 2])).toBe('[1,2]');
    expect(_serializeForOutlet({ a: 1 })).toBe('{"a":1}');
  });

  it('falls back to String() when JSON.stringify throws', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const result = _serializeForOutlet(cyclic);
    // Either falls into try-catch (String coerce) or throws inside JSON.
    expect(typeof result).toBe('string');
  });
});

describe('lom_observe', () => {
  it('outlets the observer id and registers a LiveAPI with the given prop', () => {
    let capturedHandler;
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler, path) => {
      capturedHandler = handler;
      return { property: '', _path: path };
    });
    try {
      lom_observe(1, 'live_set', 'tempo', 100);
    } finally {
      global.LiveAPI = original;
    }
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('ok');
    const obsId = lastOutlet[4];
    expect(typeof obsId).toBe('number');
    expect(obsId).toBeGreaterThan(0);
    expect(capturedHandler).toBeInstanceOf(Function);
  });

  it('sanitises throttleMs to >=0 (NaN/negative becomes 0)', () => {
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation(() => ({ property: '' }));
    try {
      lom_observe(1, 'live_set', 'tempo', -50);
      lom_observe(2, 'live_set', 'tempo', 'not-a-number');
    } finally {
      global.LiveAPI = original;
    }
    // Both succeeded
    expect(outlet.mock.calls.filter((c) => c[3] === 'ok').length).toBe(2);
  });

  it('handler emits via outlet immediately when throttle window has passed', () => {
    let capturedHandler;
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler) => {
      capturedHandler = handler;
      return { property: '' };
    });
    try {
      lom_observe(1, 'live_set', 'tempo', 0); // no throttle
      const obsId = outlet.mock.calls.at(-1)[4];
      outlet.mockClear();
      capturedHandler(['tempo', 130]);
      const lastOutlet = outlet.mock.calls.at(-1);
      expect(lastOutlet).toEqual([0, 'lom_event', obsId, 130]);
    } finally {
      global.LiveAPI = original;
    }
  });

  it('handler forwards the array form when more than one value in args', () => {
    let capturedHandler;
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler) => {
      capturedHandler = handler;
      return { property: '' };
    });
    try {
      lom_observe(1, 'live_set', 'foo', 0);
      outlet.mockClear();
      // 3 atoms after the prop name → array
      capturedHandler(['foo', 'a', 'b', 'c']);
      const lastOutlet = outlet.mock.calls.at(-1);
      // Array gets JSON-stringified by _serializeForOutlet
      expect(lastOutlet[3]).toBe('["a","b","c"]');
    } finally {
      global.LiveAPI = original;
    }
  });

  it('handler suppresses + schedules flush when throttle is active', () => {
    let capturedHandler;
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler) => {
      capturedHandler = handler;
      return { property: '' };
    });
    const originalTask = global.Task;
    let scheduledFn;
    global.Task = jest.fn().mockImplementation((fn) => {
      scheduledFn = fn;
      return { schedule: jest.fn(), cancel: jest.fn() };
    });
    try {
      lom_observe(99, 'live_set', 'tempo', 100);
      const _obsId = outlet.mock.calls.at(-1)[4];
      outlet.mockClear();
      // First emit goes through immediately (last_emit was 0, which is < now-100ms)
      // ... actually last_emit=0 means now-0 >= 100, so immediate.
      capturedHandler(['tempo', 120]);
      // Second emit RIGHT after — within throttle window, should be suppressed.
      capturedHandler(['tempo', 130]);
      // Outlet emitted once for the first call; the second is pending.
      expect(outlet.mock.calls.filter((c) => c[1] === 'lom_event').length).toBe(1);
      // The pending value gets emitted when scheduledFn runs.
      scheduledFn();
      expect(outlet.mock.calls.filter((c) => c[1] === 'lom_event').length).toBe(2);
    } finally {
      global.LiveAPI = original;
      global.Task = originalTask;
    }
  });

  it('handler is a no-op for stale callbacks (after the observer was freed)', () => {
    let capturedHandler;
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler) => {
      capturedHandler = handler;
      return { property: '' };
    });
    try {
      lom_observe(1, 'live_set', 'tempo', 0);
      const obsId = outlet.mock.calls.at(-1)[4];
      outlet.mockClear();
      // Free first.
      lom_unobserve(2, obsId);
      outlet.mockClear();
      // Now the captured handler is stale.
      capturedHandler(['tempo', 999]);
      // No lom_event should fire.
      expect(outlet.mock.calls.filter((c) => c[1] === 'lom_event').length).toBe(0);
    } finally {
      global.LiveAPI = original;
    }
  });
});

describe('lom_unobserve', () => {
  it('returns "already-freed" when the observer id is unknown', () => {
    lom_unobserve(1, 9999);
    const lastOutlet = outlet.mock.calls.at(-1);
    expect(lastOutlet[3]).toBe('ok');
    expect(lastOutlet[4]).toBe('already-freed');
  });

  it('swallows errors when setting api.property = "" throws (defensive)', () => {
    const original = global.LiveAPI;
    // Build an api whose `property` setter throws.
    global.LiveAPI = jest.fn().mockImplementation(() => {
      const obj = {};
      Object.defineProperty(obj, 'property', {
        set: () => {
          throw new Error('cannot set');
        },
        configurable: true,
      });
      return obj;
    });
    try {
      lom_observe(1, 'live_set', 'tempo', 0);
      const obsId = outlet.mock.calls.at(-1)[4];
      // Should not throw, even though api.property = '' fails.
      expect(() => lom_unobserve(2, obsId)).not.toThrow();
    } finally {
      global.LiveAPI = original;
    }
  });

  it('cancels the pending Task timer if one is set', () => {
    let capturedHandler;
    const cancelSpy = jest.fn();
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler) => {
      capturedHandler = handler;
      return { property: '' };
    });
    const originalTask = global.Task;
    global.Task = jest.fn().mockImplementation(() => ({ schedule: jest.fn(), cancel: cancelSpy }));
    try {
      lom_observe(1, 'live_set', 'tempo', 100);
      const obsId = outlet.mock.calls.at(-1)[4];
      // Trigger throttle so a timer is created.
      capturedHandler(['tempo', 1]); // immediate (last_emit=0)
      capturedHandler(['tempo', 2]); // suppressed → schedules timer
      lom_unobserve(2, obsId);
      expect(cancelSpy).toHaveBeenCalled();
    } finally {
      global.LiveAPI = original;
      global.Task = originalTask;
    }
  });
});

describe('_scheduleObserverFlush', () => {
  it('is a no-op when the observer no longer exists', () => {
    expect(() => _scheduleObserverFlush(99999)).not.toThrow();
  });

  it('is a no-op when the observer was freed BEFORE the scheduled fn fires', () => {
    let capturedHandler;
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler) => {
      capturedHandler = handler;
      return { property: '' };
    });
    let scheduledFn;
    const originalTask = global.Task;
    global.Task = jest.fn().mockImplementation((fn) => {
      scheduledFn = fn;
      return { schedule: jest.fn(), cancel: jest.fn() };
    });
    try {
      lom_observe(1, 'live_set', 'tempo', 100);
      const obsId = outlet.mock.calls.at(-1)[4];
      capturedHandler(['tempo', 1]);
      capturedHandler(['tempo', 2]);
      lom_unobserve(2, obsId);
      const before = outlet.mock.calls.length;
      scheduledFn();
      expect(outlet.mock.calls.length).toBe(before);
    } finally {
      global.LiveAPI = original;
      global.Task = originalTask;
    }
  });

  it('is a no-op when there is no pending value at flush time', () => {
    let capturedHandler;
    const original = global.LiveAPI;
    global.LiveAPI = jest.fn().mockImplementation((handler) => {
      capturedHandler = handler;
      return { property: '' };
    });
    let scheduledFn;
    const originalTask = global.Task;
    global.Task = jest.fn().mockImplementation((fn) => {
      scheduledFn = fn;
      return { schedule: jest.fn(), cancel: jest.fn() };
    });
    try {
      lom_observe(1, 'live_set', 'tempo', 100);
      capturedHandler(['tempo', 1]); // immediate
      capturedHandler(['tempo', 2]); // suppressed → scheduled
      // Manually clear the pending value before the timer fires.
      // Actually we can't easily access the observer state here ; instead,
      // call scheduledFn twice — second call has pending=null and bails.
      scheduledFn(); // emits the pending value (clears it)
      const before = outlet.mock.calls.length;
      scheduledFn(); // pending is now null, no emit
      expect(outlet.mock.calls.length).toBe(before);
    } finally {
      global.LiveAPI = original;
      global.Task = originalTask;
    }
  });
});
