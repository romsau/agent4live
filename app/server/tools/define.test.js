'use strict';

// Tests for defineTool — the wrapper that turns a config object into a
// server.tool() call with try/catch + uiLog telemetry.

jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { defineTool } = require('./define');
const { uiLog } = require('../ui/state');

/** @returns {{ tool: jest.Mock, lastCall: () => Array }} */
function mockServer() {
  const tool = jest.fn();
  return { tool, lastCall: () => tool.mock.calls.at(-1) };
}

describe('defineTool', () => {
  beforeEach(() => {
    uiLog.mockClear();
  });

  it('registers a tool with name, description, schema and a wrapper handler', () => {
    const server = mockServer();
    defineTool(server, {
      name: 'set_tempo',
      description: 'desc',
      schema: { value: 'zod_schema' },
      handler: () => Promise.resolve('ok'),
      successText: 'tempo set',
    });
    const [name, description, schema, handler] = server.lastCall();
    expect(name).toBe('set_tempo');
    expect(description).toBe('desc');
    expect(schema).toEqual({ value: 'zod_schema' });
    expect(typeof handler).toBe('function');
  });

  it('defaults schema to {} when omitted', () => {
    const server = mockServer();
    defineTool(server, {
      name: 'noop',
      description: 'd',
      handler: () => Promise.resolve(),
      successText: 'done',
    });
    const [, , schema] = server.lastCall();
    expect(schema).toEqual({});
  });

  it('returns content array with successText (static string)', async () => {
    const server = mockServer();
    defineTool(server, {
      name: 'fire_clip',
      description: 'd',
      handler: () => Promise.resolve('result'),
      successText: 'fired',
    });
    const handler = server.lastCall()[3];
    const result = await handler({ track: 0 });
    expect(result).toEqual({ content: [{ type: 'text', text: 'fired' }] });
  });

  it('passes args + handler result to successText when it is a function', async () => {
    const server = mockServer();
    defineTool(server, {
      name: 'set_tempo',
      description: 'd',
      handler: () => Promise.resolve(140),
      successText: ({ value }, res) => `tempo ${value} → ${res}`,
    });
    const handler = server.lastCall()[3];
    const result = await handler({ value: 140 });
    expect(result.content[0].text).toBe('tempo 140 → 140');
  });

  it('logs success via uiLog with the default label format', async () => {
    const server = mockServer();
    defineTool(server, {
      name: 'set_tempo',
      description: 'd',
      handler: () => Promise.resolve(),
      successText: 'ok',
    });
    await server.lastCall()[3]({ value: 140 });
    expect(uiLog).toHaveBeenCalledWith('set_tempo(140)', false);
  });

  it('uses a custom label function when provided', async () => {
    const server = mockServer();
    defineTool(server, {
      name: 'add_clip',
      description: 'd',
      handler: () => Promise.resolve(),
      successText: 'ok',
      label: ({ track, slot }) => `add_clip[${track}|${slot}]`,
    });
    await server.lastCall()[3]({ track: 2, slot: 0 });
    expect(uiLog).toHaveBeenCalledWith('add_clip[2|0]', false);
  });

  it('falls back to bare tool name when no args provided', async () => {
    const server = mockServer();
    defineTool(server, {
      name: 'stop_all_clips',
      description: 'd',
      handler: () => Promise.resolve(),
      successText: 'ok',
    });
    await server.lastCall()[3]();
    expect(uiLog).toHaveBeenCalledWith('stop_all_clips', false);
  });

  it('renders undefined args as "-" in the default label', async () => {
    const server = mockServer();
    defineTool(server, {
      name: 'lom_get',
      description: 'd',
      handler: () => Promise.resolve(),
      successText: 'ok',
    });
    await server.lastCall()[3]({ path: 'live_set', prop: undefined });
    expect(uiLog).toHaveBeenCalledWith('lom_get(live_set,-)', false);
  });

  it('logs failure with isError=true and re-throws', async () => {
    const server = mockServer();
    defineTool(server, {
      name: 'set_tempo',
      description: 'd',
      handler: () => Promise.reject(new Error('out of range')),
      successText: 'ok',
    });
    await expect(server.lastCall()[3]({ value: -1 })).rejects.toThrow('out of range');
    expect(uiLog).toHaveBeenCalledWith('set_tempo(-1)', true);
  });
});
