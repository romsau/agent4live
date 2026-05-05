'use strict';

jest.mock('../lom', () => ({
  lomGet: jest.fn(),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const { lomGet } = require('../lom');
const family = require('./tuning');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  jest.clearAllMocks();
});

it('registers the 1 tuning tool', () => {
  expect(tools.map((t) => t.name)).toEqual(['get_tuning_system']);
  for (const t of tools) expect(t.description.length).toBeGreaterThan(20);
});

it('get_tuning_system aggregates the 6 LOM properties into a JSON blob when a custom system is loaded', async () => {
  // Each lomGet call resolves with a different mock value to verify the
  // handler maps each property to the correct field of the returned JSON.
  lomGet
    .mockResolvedValueOnce('Bohlen-Pierce') // name (truthy → "available" branch)
    .mockResolvedValueOnce(1200) // pseudo_octave_in_cents
    .mockResolvedValueOnce({ note: 0, octave: -2 }) // lowest_note
    .mockResolvedValueOnce({ note: 0, octave: 8 }) // highest_note
    .mockResolvedValueOnce({ pitch: 69, hz: 440 }) // reference_pitch
    .mockResolvedValueOnce([0, 100, 200, 300]); // note_tunings (sample)

  const text = await callHandlerText(byName('get_tuning_system').handler);
  const parsed = JSON.parse(text);
  expect(parsed).toEqual({
    available: true,
    name: 'Bohlen-Pierce',
    pseudo_octave_in_cents: 1200,
    lowest_note: { note: 0, octave: -2 },
    highest_note: { note: 0, octave: 8 },
    reference_pitch: { pitch: 69, hz: 440 },
    note_tunings: [0, 100, 200, 300],
  });
  // All 6 reads target the same canonical path.
  for (const call of lomGet.mock.calls) {
    expect(call[0]).toBe('live_set tuning_system');
  }
  expect(lomGet).toHaveBeenCalledTimes(6);
});

// When Live's set has no custom tuning system loaded, every LOM read returns
// numeric 0 — the empirical sentinel discovered in runtime testing. The
// handler short-circuits to {available:false} so the agent doesn't surface
// nonsense fields ("name":0, etc.) to the user.
it.each([
  ['name returned as numeric 0', 0],
  ['name returned as string "0"', '0'],
  ['name returned as falsy null', null],
])('get_tuning_system reports {available:false} when %s', async (_label, nameValue) => {
  lomGet
    .mockResolvedValueOnce(nameValue)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0);

  const text = await callHandlerText(byName('get_tuning_system').handler);
  const parsed = JSON.parse(text);
  expect(parsed.available).toBe(false);
  expect(parsed).toHaveProperty('note');
  expect(parsed.name).toBeUndefined();
});
