'use strict';

// Tests for the transport tool family.

jest.mock('../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve('ok')),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const lom = require('../lom');
const family = require('./transport');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  lom.lomCall.mockClear();
  lom.lomSet.mockClear();
});

it('every tool has a non-empty description', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(20);
});

it('registers the expected names', () => {
  expect(tools.map((t) => t.name)).toEqual([
    'start_playing',
    'stop_playing',
    'continue_playing',
    'set_metronome',
    'set_record_mode',
    'tap_tempo',
    'capture_midi',
    'trigger_session_record',
    'jump_by',
    'scrub_by',
    'undo',
    'redo',
  ]);
});

describe.each([
  ['start_playing', 'Transport started'],
  ['stop_playing', 'Transport stopped'],
  ['continue_playing', 'Transport continued'],
  ['tap_tempo', 'Tap registered'],
  ['undo', 'Undone (warning: see tool description for caveats)'],
  ['redo', 'Redone'],
])('%s (no-arg)', (name, expectedText) => {
  it(`calls lomCall('live_set', '${name}') and returns "${expectedText}"`, async () => {
    const text = await callHandlerText(byName(name).handler);
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', name);
    expect(text).toBe(expectedText);
  });
});

describe('set_metronome', () => {
  it('encodes boolean → 1/0 for the LiveAPI', async () => {
    await callHandlerText(byName('set_metronome').handler, { on: true });
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set', 'metronome', 1);
    await callHandlerText(byName('set_metronome').handler, { on: false });
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set', 'metronome', 0);
  });

  it('successText reflects the on/off state', async () => {
    expect(await callHandlerText(byName('set_metronome').handler, { on: true })).toBe(
      'Metronome enabled',
    );
    expect(await callHandlerText(byName('set_metronome').handler, { on: false })).toBe(
      'Metronome disabled',
    );
  });
});

describe('set_record_mode', () => {
  it('encodes boolean → 1/0 and reports the new state', async () => {
    expect(await callHandlerText(byName('set_record_mode').handler, { on: true })).toBe(
      'Record mode enabled',
    );
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set', 'record_mode', 1);
    expect(await callHandlerText(byName('set_record_mode').handler, { on: false })).toBe(
      'Record mode disabled',
    );
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set', 'record_mode', 0);
  });
});

describe('capture_midi', () => {
  it('forwards destination as a positional arg', async () => {
    await callHandlerText(byName('capture_midi').handler, { destination: 1 });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set', 'capture_midi', 1);
  });
});

describe('trigger_session_record', () => {
  it('without record_length: calls without trailing arg', async () => {
    await callHandlerText(byName('trigger_session_record').handler, {});
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set', 'trigger_session_record');
  });

  it('with record_length: forwards it + recap', async () => {
    const text = await callHandlerText(byName('trigger_session_record').handler, {
      record_length: 8,
    });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set', 'trigger_session_record', 8);
    expect(text).toContain('length 8 beats');
  });
});

describe.each([
  ['jump_by', 'Jumped by'],
  ['scrub_by', 'Scrubbed by'],
])('%s', (name, prefix) => {
  it('forwards beats and recaps', async () => {
    const text = await callHandlerText(byName(name).handler, { beats: -4 });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set', name, -4);
    expect(text).toBe(`${prefix} -4 beats`);
  });
});
