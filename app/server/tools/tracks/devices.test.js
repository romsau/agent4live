'use strict';

jest.mock('../../lom', () => ({
  lomMoveDevice: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./devices');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

it('move_device delegates to lomMoveDevice with all 4 indices', async () => {
  await callHandlerText(byName('move_device').handler, {
    from_track: 0,
    from_device_index: 1,
    to_track: 2,
    to_position: 0,
  });
  expect(lom.lomMoveDevice).toHaveBeenCalledWith(0, 1, 2, 0);
});
