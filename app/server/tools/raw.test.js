'use strict';

// Tests for the raw tool family (lom_get / lom_set / lom_call).

jest.mock('../lom', () => ({
  lomGet: jest.fn(() => Promise.resolve('VAL')),
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve('CALL_RESULT')),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const lom = require('../lom');
const family = require('./raw');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  lom.lomGet.mockClear();
  lom.lomSet.mockClear();
  lom.lomCall.mockClear();
});

it('registers exactly the 3 raw tools', () => {
  expect(tools.map((t) => t.name)).toEqual(['lom_get', 'lom_set', 'lom_call']);
});

it('every tool has a non-empty description', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(20);
});

describe('lom_get', () => {
  const tool = () => byName('lom_get');

  it('schema has path + property', () => {
    expect(Object.keys(tool().schema)).toEqual(['path', 'property']);
  });

  it('handler delegates to lomGet and returns the value as a string', async () => {
    const text = await callHandlerText(tool().handler, {
      path: 'live_set tracks 0',
      property: 'name',
    });
    expect(lom.lomGet).toHaveBeenCalledWith('live_set tracks 0', 'name');
    expect(text).toBe('VAL');
  });
});

describe('lom_set', () => {
  const tool = () => byName('lom_set');

  it('schema has path + property + value', () => {
    expect(Object.keys(tool().schema)).toEqual(['path', 'property', 'value']);
  });

  it('handler delegates to lomSet, successText recaps the assignment', async () => {
    const text = await callHandlerText(tool().handler, {
      path: 'live_set tracks 0 mixer_device volume',
      property: 'value',
      value: 0.85,
    });
    expect(lom.lomSet).toHaveBeenCalledWith('live_set tracks 0 mixer_device volume', 'value', 0.85);
    expect(text).toBe('Set value on live_set tracks 0 mixer_device volume to 0.85');
  });
});

describe('lom_call', () => {
  const tool = () => byName('lom_call');

  it('schema has path + method + optional arg', () => {
    expect(Object.keys(tool().schema)).toEqual(['path', 'method', 'arg']);
  });

  it('handler delegates to lomCall, successText recaps the call', async () => {
    const text = await callHandlerText(tool().handler, {
      path: 'live_set',
      method: 'start_playing',
    });
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'start_playing', undefined);
    expect(text).toBe('Called start_playing on live_set');
  });

  it('passes the optional arg when provided', async () => {
    await callHandlerText(tool().handler, {
      path: 'live_set scenes 0',
      method: 'fire',
      arg: true,
    });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set scenes 0', 'fire', true);
  });
});
