'use strict';

jest.mock('../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const lom = require('../lom');
const family = require('./scenes');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('registers the expected tools', () => {
  expect(tools.map((t) => t.name).sort()).toEqual(
    [
      'fire_scene',
      'set_scene_tempo_enabled',
      'set_scene_time_signature',
      'set_scene_time_signature_enabled',
      'fire_scene_with_options',
      'fire_as_selected_scene',
      'create_scene',
      'delete_scene',
      'duplicate_scene',
      'capture_and_insert_scene',
      'set_scene_name',
      'set_scene_tempo',
      'set_scene_color',
    ].sort(),
  );
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

describe('fire_scene', () => {
  it('calls fire on the scene path', async () => {
    expect(await callHandlerText(byName('fire_scene').handler, { index: 2 })).toBe('Scene 2 fired');
    expect(lom.lomCall).toHaveBeenCalledWith('live_set scenes 2', 'fire');
  });
});

describe('set_scene_tempo_enabled', () => {
  it('encodes boolean → 1/0', async () => {
    expect(
      await callHandlerText(byName('set_scene_tempo_enabled').handler, { scene: 1, on: true }),
    ).toBe('Scene 1 tempo_enabled on');
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set scenes 1', 'tempo_enabled', 1);
    expect(
      await callHandlerText(byName('set_scene_tempo_enabled').handler, { scene: 1, on: false }),
    ).toBe('Scene 1 tempo_enabled off');
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set scenes 1', 'tempo_enabled', 0);
  });
});

describe('set_scene_time_signature', () => {
  it('issues numerator+denominator when both provided', async () => {
    await callHandlerText(byName('set_scene_time_signature').handler, {
      scene: 0,
      numerator: 6,
      denominator: 8,
    });
    expect(lom.lomSet).toHaveBeenNthCalledWith(
      1,
      'live_set scenes 0',
      'time_signature_numerator',
      6,
    );
    expect(lom.lomSet).toHaveBeenNthCalledWith(
      2,
      'live_set scenes 0',
      'time_signature_denominator',
      8,
    );
  });

  it('issues only numerator when denominator is omitted', async () => {
    await callHandlerText(byName('set_scene_time_signature').handler, { scene: 0, numerator: 5 });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith('live_set scenes 0', 'time_signature_numerator', 5);
  });

  it('issues only denominator when numerator is omitted', async () => {
    await callHandlerText(byName('set_scene_time_signature').handler, {
      scene: 0,
      denominator: 16,
    });
    expect(lom.lomSet).toHaveBeenCalledTimes(1);
    expect(lom.lomSet).toHaveBeenCalledWith('live_set scenes 0', 'time_signature_denominator', 16);
  });

  it('throws if neither numerator nor denominator is provided', async () => {
    await expect(byName('set_scene_time_signature').handler({ scene: 0 })).rejects.toThrow(
      /at least one of numerator/,
    );
  });
});

describe('set_scene_time_signature_enabled', () => {
  it('encodes boolean → 1/0', async () => {
    await callHandlerText(byName('set_scene_time_signature_enabled').handler, {
      scene: 1,
      on: true,
    });
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set scenes 1', 'time_signature_enabled', 1);
    await callHandlerText(byName('set_scene_time_signature_enabled').handler, {
      scene: 1,
      on: false,
    });
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set scenes 1', 'time_signature_enabled', 0);
  });
});

describe('fire_scene_with_options', () => {
  it('falls back to plain fire when no options provided', async () => {
    await callHandlerText(byName('fire_scene_with_options').handler, { index: 0 });
    expect(lom.lomCall).toHaveBeenCalledWith('live_set scenes 0', 'fire');
  });

  it('passes force_legato alone (true → 1, false → 0)', async () => {
    await callHandlerText(byName('fire_scene_with_options').handler, {
      index: 0,
      force_legato: true,
    });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set scenes 0', 'fire', 1);
    await callHandlerText(byName('fire_scene_with_options').handler, {
      index: 0,
      force_legato: false,
    });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set scenes 0', 'fire', 0);
  });

  it('passes both flags when both provided (covers both true/false branches)', async () => {
    await callHandlerText(byName('fire_scene_with_options').handler, {
      index: 0,
      force_legato: true,
      can_select_scene_on_launch: false,
    });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set scenes 0', 'fire', 1, 0);
    await callHandlerText(byName('fire_scene_with_options').handler, {
      index: 0,
      force_legato: false,
      can_select_scene_on_launch: true,
    });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set scenes 0', 'fire', 0, 1);
  });

  it('throws when can_select_scene_on_launch is provided without force_legato', async () => {
    await expect(
      byName('fire_scene_with_options').handler({ index: 0, can_select_scene_on_launch: true }),
    ).rejects.toThrow(/requires force_legato/);
  });
});

describe('fire_as_selected_scene', () => {
  it('without force_legato: bare call', async () => {
    await callHandlerText(byName('fire_as_selected_scene').handler, {});
    expect(lom.lomCall).toHaveBeenCalledWith('live_set scenes 0', 'fire_as_selected');
  });

  it('with force_legato: passes 1/0', async () => {
    await callHandlerText(byName('fire_as_selected_scene').handler, { force_legato: true });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set scenes 0', 'fire_as_selected', 1);
    await callHandlerText(byName('fire_as_selected_scene').handler, { force_legato: false });
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set scenes 0', 'fire_as_selected', 0);
  });
});

describe('create_scene / delete_scene / duplicate_scene', () => {
  it('create_scene defaults index to -1 → "at end" recap', async () => {
    expect(await callHandlerText(byName('create_scene').handler, {})).toBe('Scene created at end');
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set', 'create_scene', -1);
  });

  it('create_scene at explicit index reports the position', async () => {
    expect(await callHandlerText(byName('create_scene').handler, { index: 3 })).toBe(
      'Scene created at index 3',
    );
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set', 'create_scene', 3);
  });

  it('delete_scene calls live_set delete_scene with index', async () => {
    expect(await callHandlerText(byName('delete_scene').handler, { index: 2 })).toBe(
      'Scene 2 deleted',
    );
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set', 'delete_scene', 2);
  });

  it('duplicate_scene calls live_set duplicate_scene with index', async () => {
    expect(await callHandlerText(byName('duplicate_scene').handler, { index: 1 })).toBe(
      'Scene 1 duplicated',
    );
    expect(lom.lomCall).toHaveBeenLastCalledWith('live_set', 'duplicate_scene', 1);
  });
});

describe('capture_and_insert_scene', () => {
  it('calls capture_and_insert_scene on live_set', async () => {
    await callHandlerText(byName('capture_and_insert_scene').handler);
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'capture_and_insert_scene');
  });
});

describe('set_scene_name', () => {
  it('writes the name property and recaps', async () => {
    expect(
      await callHandlerText(byName('set_scene_name').handler, { index: 0, name: 'Drop' }),
    ).toBe('Scene 0 renamed to "Drop"');
    expect(lom.lomSet).toHaveBeenCalledWith('live_set scenes 0', 'name', 'Drop');
  });
});

describe('set_scene_tempo', () => {
  it('writes positive bpm and reports the new value', async () => {
    expect(await callHandlerText(byName('set_scene_tempo').handler, { index: 1, bpm: 120 })).toBe(
      'Scene 1 tempo set to 120 BPM',
    );
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set scenes 1', 'tempo', 120);
  });

  it('reports "disabled (inherits song)" when bpm < 0', async () => {
    expect(await callHandlerText(byName('set_scene_tempo').handler, { index: 1, bpm: -1 })).toBe(
      'Scene 1 tempo disabled (inherits song)',
    );
  });
});

describe('set_scene_color', () => {
  it('writes the color and reports it as zero-padded uppercase hex', async () => {
    expect(
      await callHandlerText(byName('set_scene_color').handler, { index: 0, color: 0x00ff00 }),
    ).toBe('Scene 0 color set to 0x00FF00');
    expect(lom.lomSet).toHaveBeenLastCalledWith('live_set scenes 0', 'color', 0x00ff00);
  });
});
