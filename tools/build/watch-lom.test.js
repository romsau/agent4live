'use strict';

jest.mock('fs');
jest.mock('./concat-lom', () => ({ concat: jest.fn() }));

const fs = require('fs');
const { concat } = require('./concat-lom');
const { schedule, start } = require('./watch-lom');

describe('schedule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces concat call until 100ms after the last save', () => {
    schedule('a.js');
    schedule('a.js');
    schedule('b.js');
    expect(concat).not.toHaveBeenCalled();
    jest.advanceTimersByTime(99);
    expect(concat).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(concat).toHaveBeenCalledTimes(1);
  });

  it('logs error when concat throws', () => {
    concat.mockImplementation(() => {
      throw new Error('busted');
    });
    const errCalls = [];
    const origErr = console.error;
    const origLog = console.log;
    console.error = (...a) => errCalls.push(a);
    console.log = () => {};
    try {
      schedule('a.js');
      jest.advanceTimersByTime(100);
    } finally {
      console.error = origErr;
      console.log = origLog;
    }
    expect(errCalls).toContainEqual(['[dev:lom] concat failed:', 'busted']);
  });

  it('logs success after a normal concat', () => {
    concat.mockImplementation(() => {});
    const logCalls = [];
    const origLog = console.log;
    console.log = (...a) => logCalls.push(a);
    try {
      schedule('foo.js');
      jest.advanceTimersByTime(100);
    } finally {
      console.log = origLog;
    }
    expect(logCalls.flat().join('\n')).toContain('[dev:lom] foo.js → regenerated');
  });
});

describe('start', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs initial concat, registers fs.watch, ignores non-js files and null filenames', () => {
    let watchCb = null;
    fs.watch.mockImplementation((dir, opts, cb) => {
      watchCb = cb;
      return { close: jest.fn() };
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const watcher = start();
      expect(watcher).toBeDefined();
      expect(concat).toHaveBeenCalledTimes(1);
      expect(fs.watch).toHaveBeenCalled();

      // Ignored events.
      watchCb('change', null);
      watchCb('change', 'README.md');
      jest.advanceTimersByTime(150);
      expect(concat).toHaveBeenCalledTimes(1);

      // Schedule on .js save.
      watchCb('change', 'something.js');
      jest.advanceTimersByTime(100);
      expect(concat).toHaveBeenCalledTimes(2);
    } finally {
      logSpy.mockRestore();
    }
  });
});
