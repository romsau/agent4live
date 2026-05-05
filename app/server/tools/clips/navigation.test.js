'use strict';

jest.mock('../../lom', () => ({
  lomCall: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./navigation');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const clipPath = (t, s) => `live_set tracks ${t} clip_slots ${s} clip`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('move_playing_pos calls move_playing_pos with beats', async () => {
  await callHandlerText(byName('move_playing_pos').handler, { track: 0, slot: 1, beats: -2 });
  expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'move_playing_pos', -2);
});

it('scrub_clip calls scrub with beat_time', async () => {
  await callHandlerText(byName('scrub_clip').handler, { track: 0, slot: 1, beat_time: 4 });
  expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'scrub', 4);
});

it('stop_scrub_clip calls stop_scrub', async () => {
  await callHandlerText(byName('stop_scrub_clip').handler, { track: 0, slot: 1 });
  expect(lom.lomCall).toHaveBeenCalledWith(clipPath(0, 1), 'stop_scrub');
});
