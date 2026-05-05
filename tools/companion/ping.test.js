'use strict';

const path = require('path');
const pythonPath = path.resolve(__dirname, '..', '..', 'app', 'server', 'python.js');

jest.mock(pythonPath, () => ({ ping: jest.fn() }));

const { ping } = require(pythonPath);
const { runPing } = require('./ping');

beforeEach(() => {
  jest.clearAllMocks();
});

it('logs the response and exits 0 on success', async () => {
  ping.mockResolvedValue({ ok: true, version: 1 });
  const log = jest.fn();
  const error = jest.fn();
  const exit = jest.fn();
  await runPing({ log, error, exit });
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining('alive'),
    expect.stringContaining('"version":1'),
  );
  expect(exit).toHaveBeenCalledWith(0);
});

it('logs the error message and exits 1 on failure', async () => {
  ping.mockRejectedValue(new Error('ECONNREFUSED'));
  const log = jest.fn();
  const error = jest.fn();
  const exit = jest.fn();
  await runPing({ log, error, exit });
  expect(error).toHaveBeenCalledWith('✗', 'ECONNREFUSED');
  expect(exit).toHaveBeenCalledWith(1);
});

it('uses console + process.exit by default when no overrides given', async () => {
  ping.mockResolvedValue({ ok: true });
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  try {
    await runPing();
    expect(logSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  } finally {
    logSpy.mockRestore();
    exitSpy.mockRestore();
  }
});
