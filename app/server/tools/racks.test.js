'use strict';

jest.mock('../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
  lomGetRackChains: jest.fn(() => Promise.resolve('CHAINS')),
  lomGetDrumPads: jest.fn(() => Promise.resolve('PADS')),
  lomGetChainDevices: jest.fn(() => Promise.resolve('CHAIN_DEVS')),
  lomGetDrumPadChains: jest.fn(() => Promise.resolve('PAD_CHAINS')),
  lomGetDrumPadChainDevices: jest.fn(() => Promise.resolve('PAD_CHAIN_DEVS')),
  lomGetChainDeviceParams: jest.fn(() => Promise.resolve('CHAIN_PARAMS')),
  lomGetDrumPadChainDeviceParams: jest.fn(() => Promise.resolve('PAD_CHAIN_PARAMS')),
  lomGetRackMacros: jest.fn(() => Promise.resolve('MACROS')),
  lomAddRackMacro: jest.fn(() => Promise.resolve()),
  lomRemoveRackMacro: jest.fn(() => Promise.resolve()),
  lomRandomizeRackMacros: jest.fn(() => Promise.resolve()),
  lomStoreRackVariation: jest.fn(() => Promise.resolve()),
  lomRecallRackVariation: jest.fn(() => Promise.resolve()),
  lomRecallLastUsedVariation: jest.fn(() => Promise.resolve()),
  lomDeleteRackVariation: jest.fn(() => Promise.resolve()),
  lomInsertRackChain: jest.fn(() => Promise.resolve()),
  lomCopyDrumPad: jest.fn(() => Promise.resolve()),
  lomSetDrumChainProps: jest.fn(() => Promise.resolve()),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const lom = require('../lom');
const family = require('./racks');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const chainPath = (t, d, c) => `live_set tracks ${t} devices ${d} chains ${c}`;
const padPath = (t, d, p) => `live_set tracks ${t} devices ${d} drum_pads ${p}`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

describe('discovery / readers', () => {
  it.each([
    ['get_rack_chains', 'lomGetRackChains', { track: 0, device_index: 0 }, [0, 0], 'CHAINS'],
    [
      'get_drum_pads',
      'lomGetDrumPads',
      { track: 0, device_index: 0, only_visible: true },
      [0, 0, true],
      'PADS',
    ],
    [
      'get_chain_devices',
      'lomGetChainDevices',
      { track: 0, device_index: 0, chain_index: 1 },
      [0, 0, 1],
      'CHAIN_DEVS',
    ],
    [
      'get_drum_pad_chains',
      'lomGetDrumPadChains',
      { track: 0, device_index: 0, pad_index: 36 },
      [0, 0, 36],
      'PAD_CHAINS',
    ],
    [
      'get_drum_pad_chain_devices',
      'lomGetDrumPadChainDevices',
      { track: 0, device_index: 0, pad_index: 36, chain_index: 0 },
      [0, 0, 36, 0],
      'PAD_CHAIN_DEVS',
    ],
    [
      'get_chain_device_params',
      'lomGetChainDeviceParams',
      { track: 0, device_index: 0, chain_index: 1, sub_device_index: 0 },
      [0, 0, 1, 0],
      'CHAIN_PARAMS',
    ],
    [
      'get_drum_pad_chain_device_params',
      'lomGetDrumPadChainDeviceParams',
      { track: 0, device_index: 0, pad_index: 36, chain_index: 0, sub_device_index: 0 },
      [0, 0, 36, 0, 0],
      'PAD_CHAIN_PARAMS',
    ],
    ['get_rack_macros', 'lomGetRackMacros', { track: 0, device_index: 0 }, [0, 0], 'MACROS'],
  ])(
    '%s delegates to %s with the right args',
    async (name, helper, args, expectedArgs, payload) => {
      const text = await callHandlerText(byName(name).handler, args);
      expect(lom[helper]).toHaveBeenCalledWith(...expectedArgs);
      expect(text).toBe(payload);
    },
  );
});

describe('chain device param setters', () => {
  it('set_chain_device_param writes value at the resolved path', async () => {
    await callHandlerText(byName('set_chain_device_param').handler, {
      track: 0,
      device_index: 0,
      chain_index: 1,
      sub_device_index: 0,
      param_index: 5,
      value: 0.5,
    });
    expect(lom.lomSet).toHaveBeenCalledWith(
      `${chainPath(0, 0, 1)} devices 0 parameters 5`,
      'value',
      0.5,
    );
  });

  it('set_drum_pad_chain_device_param writes value at the deeper path', async () => {
    await callHandlerText(byName('set_drum_pad_chain_device_param').handler, {
      track: 0,
      device_index: 0,
      pad_index: 36,
      chain_index: 0,
      sub_device_index: 1,
      param_index: 2,
      value: 0.7,
    });
    expect(lom.lomSet).toHaveBeenCalledWith(
      `${padPath(0, 0, 36)} chains 0 devices 1 parameters 2`,
      'value',
      0.7,
    );
  });
});

describe('macro / variation actions', () => {
  it.each([
    ['add_rack_macro', 'lomAddRackMacro', 'Macro added'],
    ['remove_rack_macro', 'lomRemoveRackMacro', 'Macro removed'],
    ['randomize_rack_macros', 'lomRandomizeRackMacros', 'Macros randomized'],
    ['store_rack_variation', 'lomStoreRackVariation', 'Variation stored'],
    ['recall_last_used_rack_variation', 'lomRecallLastUsedVariation', 'Last variation recalled'],
    ['delete_rack_variation', 'lomDeleteRackVariation', 'Variation deleted'],
  ])('%s delegates and recaps', async (name, helper, expected) => {
    const text = await callHandlerText(byName(name).handler, { track: 0, device_index: 0 });
    expect(lom[helper]).toHaveBeenCalledWith(0, 0);
    expect(text).toBe(expected);
  });

  it('recall_rack_variation passes the index when provided, "(selected)" recap when omitted', async () => {
    expect(
      await callHandlerText(byName('recall_rack_variation').handler, {
        track: 0,
        device_index: 0,
        variation_index: 2,
      }),
    ).toBe('Variation 2 recalled');
    expect(lom.lomRecallRackVariation).toHaveBeenLastCalledWith(0, 0, 2);

    expect(
      await callHandlerText(byName('recall_rack_variation').handler, { track: 0, device_index: 0 }),
    ).toBe('Variation (selected) recalled');
    expect(lom.lomRecallRackVariation).toHaveBeenLastCalledWith(0, 0, undefined);
  });
});

describe('insert_rack_chain', () => {
  it('without position: end + recap "end"', async () => {
    expect(
      await callHandlerText(byName('insert_rack_chain').handler, { track: 0, device_index: 0 }),
    ).toBe('Chain inserted at end');
    expect(lom.lomInsertRackChain).toHaveBeenLastCalledWith(0, 0, undefined);
  });

  it('with position: passes position + recap', async () => {
    expect(
      await callHandlerText(byName('insert_rack_chain').handler, {
        track: 0,
        device_index: 0,
        position: 2,
      }),
    ).toBe('Chain inserted at 2');
    expect(lom.lomInsertRackChain).toHaveBeenLastCalledWith(0, 0, 2);
  });
});

describe('insert_chain_device / delete_chain_device', () => {
  it('insert_chain_device without target_index: appends', async () => {
    await callHandlerText(byName('insert_chain_device').handler, {
      track: 0,
      device_index: 0,
      chain_index: 1,
      device_name: 'Reverb',
    });
    expect(lom.lomCall).toHaveBeenCalledWith(chainPath(0, 0, 1), 'insert_device', 'Reverb');
  });

  it('insert_chain_device with target_index: passes position', async () => {
    await callHandlerText(byName('insert_chain_device').handler, {
      track: 0,
      device_index: 0,
      chain_index: 1,
      device_name: 'EQ Eight',
      target_index: 0,
    });
    expect(lom.lomCall).toHaveBeenCalledWith(chainPath(0, 0, 1), 'insert_device', 'EQ Eight', 0);
  });

  it('delete_chain_device calls delete_device on the chain', async () => {
    await callHandlerText(byName('delete_chain_device').handler, {
      track: 0,
      device_index: 0,
      chain_index: 1,
      sub_device_index: 0,
    });
    expect(lom.lomCall).toHaveBeenCalledWith(chainPath(0, 0, 1), 'delete_device', 0);
  });
});

describe('chain props (regular Rack)', () => {
  it('set_chain_name writes name', async () => {
    expect(
      await callHandlerText(byName('set_chain_name').handler, {
        track: 0,
        device_index: 0,
        chain_index: 1,
        name: 'Lead',
      }),
    ).toBe('Chain 1 renamed to "Lead"');
    expect(lom.lomSet).toHaveBeenCalledWith(chainPath(0, 0, 1), 'name', 'Lead');
  });

  it('set_chain_color writes color and recaps as hex', async () => {
    expect(
      await callHandlerText(byName('set_chain_color').handler, {
        track: 0,
        device_index: 0,
        chain_index: 1,
        color: 0xff8800,
      }),
    ).toBe('Chain 1 color set to 0xFF8800');
  });

  it.each([
    ['set_chain_mute', 'mute', true, 'muted'],
    ['set_chain_mute', 'mute', false, 'unmuted'],
    ['set_chain_solo', 'solo', true, 'soloed'],
    ['set_chain_solo', 'solo', false, 'un-soloed'],
    ['set_chain_auto_colored', 'is_auto_colored', true, 'auto-color on'],
    ['set_chain_auto_colored', 'is_auto_colored', false, 'auto-color off'],
  ])('%s writes %s as 1/0 and recaps', async (name, prop, on, expectedSuffix) => {
    const text = await callHandlerText(byName(name).handler, {
      track: 0,
      device_index: 0,
      chain_index: 1,
      on,
    });
    expect(lom.lomSet).toHaveBeenCalledWith(chainPath(0, 0, 1), prop, on ? 1 : 0);
    expect(text).toContain(expectedSuffix);
  });
});

describe('drum pad props', () => {
  it('set_drum_pad_name writes name on padPath', async () => {
    await callHandlerText(byName('set_drum_pad_name').handler, {
      track: 0,
      device_index: 0,
      pad_index: 36,
      name: 'Kick',
    });
    expect(lom.lomSet).toHaveBeenCalledWith(padPath(0, 0, 36), 'name', 'Kick');
  });

  it.each([
    ['set_drum_pad_mute', 'mute', true],
    ['set_drum_pad_mute', 'mute', false],
    ['set_drum_pad_solo', 'solo', true],
    ['set_drum_pad_solo', 'solo', false],
  ])('%s writes %s as 1/0', async (name, prop, on) => {
    await callHandlerText(byName(name).handler, {
      track: 0,
      device_index: 0,
      pad_index: 36,
      on,
    });
    expect(lom.lomSet).toHaveBeenCalledWith(padPath(0, 0, 36), prop, on ? 1 : 0);
  });

  it('copy_drum_pad delegates to lomCopyDrumPad', async () => {
    await callHandlerText(byName('copy_drum_pad').handler, {
      track: 0,
      device_index: 0,
      source_pad_index: 36,
      destination_pad_index: 40,
    });
    expect(lom.lomCopyDrumPad).toHaveBeenCalledWith(0, 0, 36, 40);
  });
});

describe('remap_drum_pad', () => {
  it('runs copy + delete_all_chains in order', async () => {
    await callHandlerText(byName('remap_drum_pad').handler, {
      track: 0,
      device_index: 0,
      source_note: 36,
      destination_note: 40,
    });
    expect(lom.lomCopyDrumPad).toHaveBeenCalledWith(0, 0, 36, 40);
    expect(lom.lomCall).toHaveBeenCalledWith(padPath(0, 0, 36), 'delete_all_chains');
  });

  it('throws if source and destination are equal', async () => {
    await expect(
      byName('remap_drum_pad').handler({
        track: 0,
        device_index: 0,
        source_note: 36,
        destination_note: 36,
      }),
    ).rejects.toThrow(/source and destination notes must differ/);
  });
});

describe('set_drum_chain_props', () => {
  it('forwards each provided field as positional args', async () => {
    await callHandlerText(byName('set_drum_chain_props').handler, {
      track: 0,
      device_index: 0,
      pad_index: 36,
      chain_index: 0,
      in_note: 60,
      out_note: 64,
      choke_group: 1,
    });
    expect(lom.lomSetDrumChainProps).toHaveBeenCalledWith(0, 0, 36, 0, 60, 64, 1);
  });

  it('passes undefined for skipped fields', async () => {
    await callHandlerText(byName('set_drum_chain_props').handler, {
      track: 0,
      device_index: 0,
      pad_index: 36,
      chain_index: 0,
      in_note: 60,
    });
    expect(lom.lomSetDrumChainProps).toHaveBeenCalledWith(0, 0, 36, 0, 60, undefined, undefined);
  });

  it('throws if all three optional fields are omitted', async () => {
    await expect(
      byName('set_drum_chain_props').handler({
        track: 0,
        device_index: 0,
        pad_index: 36,
        chain_index: 0,
      }),
    ).rejects.toThrow(/at least one of in_note/);
  });
});
