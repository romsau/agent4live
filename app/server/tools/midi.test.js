'use strict';

// Tests for the MIDI raw tool family. The Python extension is mocked at the
// helper level so we never touch a real socket.

jest.mock('../extension/bridge', () => ({
  isAlive: jest.fn(),
  sendMidi: jest.fn(),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const python = require('../extension/bridge');
const family = require('./midi');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  jest.clearAllMocks();
});

it('every tool has a non-empty description', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(40);
});

it('registers the 1 midi tool (send only — receive deferred)', () => {
  expect(tools.map((t) => t.name)).toEqual(['send_midi']);
});

describe('extension gate', () => {
  it('send_midi throws a friendly error when the extension is unreachable', async () => {
    python.isAlive.mockResolvedValue(false);
    await expect(
      callHandlerText(byName('send_midi').handler, { status: 0x90, data1: 60, data2: 100 }),
    ).rejects.toThrow(/require the agent4live Python extension/);
  });
});

describe('send_midi', () => {
  it('forwards bytes to sendMidi and returns a confirmation summary', async () => {
    python.isAlive.mockResolvedValue(true);
    python.sendMidi.mockResolvedValue({ ok: true });
    const text = await callHandlerText(byName('send_midi').handler, {
      status: 0x90,
      data1: 60,
      data2: 100,
    });
    expect(python.sendMidi).toHaveBeenCalledWith(0x90, 60, 100);
    expect(text).toBe('MIDI sent: status=0x90 data1=60 data2=100');
  });

  it('surfaces the extension error when ok=false', async () => {
    python.isAlive.mockResolvedValue(true);
    python.sendMidi.mockResolvedValue({ ok: false, error: 'send_midi failed: boom' });
    await expect(
      callHandlerText(byName('send_midi').handler, { status: 0xb0, data1: 7, data2: 64 }),
    ).rejects.toThrow(/send_midi failed: boom/);
  });

  it('falls back to a generic error when ok=false has no error field', async () => {
    python.isAlive.mockResolvedValue(true);
    python.sendMidi.mockResolvedValue({ ok: false });
    await expect(
      callHandlerText(byName('send_midi').handler, { status: 0x90, data1: 0, data2: 0 }),
    ).rejects.toThrow(/extension returned an error/);
  });
});
