'use strict';

// Tests for the lom/index.js façade — every helper wraps `enqueue(() =>
// lomOp/lomCustomCall(...))`. We mock both the queue and the transport
// to capture invocations, then assert each wrapper delegates correctly.

jest.mock('./queue', () => ({
  enqueue: jest.fn((task) => task()),
}));

jest.mock('./transport', () => ({
  lomOp: jest.fn(() => Promise.resolve('OP_RESULT')),
  lomCustomCall: jest.fn(() => Promise.resolve('CUSTOM_RESULT')),
}));

const lom = require('./index');
const { enqueue } = require('./queue');
const { lomOp, lomCustomCall } = require('./transport');

beforeEach(() => {
  enqueue.mockClear();
  lomOp.mockClear();
  lomCustomCall.mockClear();
});

describe('generic LOM ops (lomOp via enqueue)', () => {
  it('lomGet routes "get" with path + prop', async () => {
    const result = await lom.lomGet('live_set', 'tempo');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(lomOp).toHaveBeenCalledWith('get', 'live_set', 'tempo');
    expect(result).toBe('OP_RESULT');
  });

  it('lomSet routes "set" with path + prop + value', async () => {
    await lom.lomSet('live_set tracks 0 mixer_device volume', 'value', 0.85);
    expect(lomOp).toHaveBeenCalledWith(
      'set',
      'live_set tracks 0 mixer_device volume',
      'value',
      0.85,
    );
  });

  it('lomCall routes "call" with method + variadic args', async () => {
    await lom.lomCall('live_set', 'start_playing');
    expect(lomOp).toHaveBeenLastCalledWith('call', 'live_set', 'start_playing');

    await lom.lomCall('live_set scenes 0', 'fire', 1, 'extra');
    expect(lomOp).toHaveBeenLastCalledWith('call', 'live_set scenes 0', 'fire', 1, 'extra');
  });
});

// Each entry is [helper, opName, [...inputArgs] | argsFn] :
//   - helper       : the lom.helperName function
//   - opName       : the expected first arg to lomCustomCall
//   - argsFn       : a function returning [inputs, expectedExtraArgs] so we
//                    can express "input is a but extras passed are b" for the
//                    helpers that translate arg shapes (e.g. -1 sentinels).
//   - or just one array : [inputs] = [extras] when they're identical.
const dedicatedSpecs = [
  // notes
  ['lomAddClip', 'lom_add_clip', [0, 1, 4, '[]']],
  ['lomGetClipNotes', 'lom_get_clip_notes', [0, 1, 60, 12, 0, 4]],
  ['lomReplaceClipNotes', 'lom_replace_clip_notes', [0, 1, '[]']],
  ['lomApplyNoteModifications', 'lom_apply_note_modifications', [0, 1, '{}']],
  ['lomGetAllNotes', 'lom_get_all_notes', [0, 1]],
  ['lomGetSelectedNotes', 'lom_get_selected_notes', [0, 1]],
  ['lomGetNotesById', 'lom_get_notes_by_id', [0, 1, '[1,2]']],
  ['lomAddNotesToClip', 'lom_add_notes_to_clip', [0, 1, '[]']],
  ['lomRemoveNotesById', 'lom_remove_notes_by_id', [0, 1, '[1]']],
  ['lomDuplicateNotesById', 'lom_duplicate_notes_by_id', [0, 1, '{}']],
  // audio clips
  ['lomGetClipAudioInfo', 'lom_get_clip_audio_info', [0, 1]],
  ['lomGetWarpMarkers', 'lom_get_warp_markers', [0, 1]],
  ['lomClearClipEnvelope', 'lom_clear_clip_envelope', [0, 1, 0, 5]],
  ['lomDuplicateClipToSlot', 'lom_duplicate_clip_to_slot', [0, 0, 1, 0]],
  ['lomDuplicateClipToArrangement', 'lom_duplicate_clip_to_arrangement', [0, 1, 16]],
  ['lomDeleteArrangementClip', 'lom_delete_arrangement_clip', [0, 0]],
  // cue points
  ['lomGetCuePoints', 'lom_get_cue_points', []],
  ['lomSetCuePointName', 'lom_set_cue_point_name', [0, 'Verse']],
  ['lomSetCuePointTime', 'lom_set_cue_point_time', [0, 16]],
  ['lomJumpToCue', 'lom_jump_to_cue', [0]],
  // tracks / devices / params
  ['lomGetTrackDevices', 'lom_get_track_devices', [2]],
  ['lomGetDeviceParams', 'lom_get_device_params', [2, 0]],
  ['lomGetTrackGroupInfo', 'lom_get_track_group_info', [3]],
  ['lomGetTakeLanes', 'lom_get_take_lanes', [3]],
  ['lomMoveDevice', 'lom_move_device', [0, 0, 1, 0]],
  ['lomSetTrackRouting', 'lom_set_track_routing', [0, 'input_routing_type', 'ext-in']],
  ['lomGetTrackRouting', 'lom_get_track_routing', [0, 'input']],
  ['lomGetDeviceIoRoutings', 'lom_get_device_io_routings', [0, 0]],
  ['lomSetDeviceIoRoutingType', 'lom_set_device_io_routing_type', [0, 0, 'audio_in', 0, 'ext']],
  ['lomSetDeviceIoRoutingChannel', 'lom_set_device_io_routing_channel', [0, 0, 'audio_in', 0, 'L']],
  // racks
  ['lomGetRackChains', 'lom_get_rack_chains', [0, 0]],
  ['lomGetChainDevices', 'lom_get_chain_devices', [0, 0, 1]],
  ['lomGetDrumPadChains', 'lom_get_drum_pad_chains', [0, 0, 36]],
  ['lomGetDrumPadChainDevices', 'lom_get_drum_pad_chain_devices', [0, 0, 36, 0]],
  ['lomGetChainDeviceParams', 'lom_get_chain_device_params', [0, 0, 1, 0]],
  ['lomGetDrumPadChainDeviceParams', 'lom_get_drum_pad_chain_device_params', [0, 0, 36, 0, 0]],
  ['lomGetRackMacros', 'lom_get_rack_macros', [0, 0]],
  ['lomAddRackMacro', 'lom_add_rack_macro', [0, 0]],
  ['lomRemoveRackMacro', 'lom_remove_rack_macro', [0, 0]],
  ['lomRandomizeRackMacros', 'lom_randomize_rack_macros', [0, 0]],
  ['lomStoreRackVariation', 'lom_store_rack_variation', [0, 0]],
  ['lomRecallLastUsedVariation', 'lom_recall_last_used_variation', [0, 0]],
  ['lomDeleteRackVariation', 'lom_delete_rack_variation', [0, 0]],
  ['lomCopyDrumPad', 'lom_copy_drum_pad', [0, 0, 36, 37]],
  // session / global
  ['lomSessionState', 'lom_session_state', []],
  ['lomScanPeers', 'lom_scan_peers', []],
  ['lomGetScale', 'lom_get_scale', []],
  ['lomGetSelection', 'lom_get_selection', []],
  ['lomSelectTrack', 'lom_select_track', [3]],
  ['lomSelectScene', 'lom_select_scene', [2]],
  ['lomSelectDevice', 'lom_select_device', [2, 1]],
  ['lomGetGrooves', 'lom_get_grooves', []],
  ['lomSetClipGroove', 'lom_set_clip_groove', [0, 0, 2]],
  ['lomGetControlSurfaces', 'lom_get_control_surfaces', []],
  ['lomGetControlSurfaceControls', 'lom_get_control_surface_controls', [0]],
  // observers
  ['lomObserve', 'lom_observe', ['live_set', 'tempo', 100]],
  ['lomUnobserve', 'lom_unobserve', [42]],
];

describe.each(dedicatedSpecs)('%s → %s', (helperName, opName, args) => {
  it('forwards args to lomCustomCall, queued via enqueue', async () => {
    const result = await lom[helperName](...args);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(lomCustomCall).toHaveBeenCalledWith(opName, ...args);
    expect(result).toBe('CUSTOM_RESULT');
  });
});

describe('helpers with sentinel-value translations', () => {
  it('lomGetDrumPads coerces onlyVisible truthy → 1, falsy → 0', async () => {
    await lom.lomGetDrumPads(0, 0, true);
    expect(lomCustomCall).toHaveBeenLastCalledWith('lom_get_drum_pads', 0, 0, 1);
    await lom.lomGetDrumPads(0, 0, false);
    expect(lomCustomCall).toHaveBeenLastCalledWith('lom_get_drum_pads', 0, 0, 0);
    await lom.lomGetDrumPads(0, 0);
    expect(lomCustomCall).toHaveBeenLastCalledWith('lom_get_drum_pads', 0, 0, 0);
  });

  it('lomAddWarpMarker substitutes NaN for undefined beat/sample times', async () => {
    await lom.lomAddWarpMarker(0, 0, 1, undefined);
    const call1 = lomCustomCall.mock.calls.at(-1);
    expect(call1[0]).toBe('lom_add_warp_marker');
    expect(call1.slice(1, 4)).toEqual([0, 0, 1]);
    expect(Number.isNaN(call1[4])).toBe(true);

    await lom.lomAddWarpMarker(0, 0, undefined, 22050);
    const call2 = lomCustomCall.mock.calls.at(-1);
    expect(Number.isNaN(call2[3])).toBe(true);
    expect(call2[4]).toBe(22050);
  });

  it('lomRecallRackVariation defaults variationIdx to -1 when undefined', async () => {
    await lom.lomRecallRackVariation(0, 0);
    expect(lomCustomCall).toHaveBeenLastCalledWith('lom_recall_rack_variation', 0, 0, -1);
    await lom.lomRecallRackVariation(0, 0, 3);
    expect(lomCustomCall).toHaveBeenLastCalledWith('lom_recall_rack_variation', 0, 0, 3);
  });

  it('lomInsertRackChain defaults position to -1 when undefined', async () => {
    await lom.lomInsertRackChain(0, 0);
    expect(lomCustomCall).toHaveBeenLastCalledWith('lom_insert_rack_chain', 0, 0, -1);
    await lom.lomInsertRackChain(0, 0, 2);
    expect(lomCustomCall).toHaveBeenLastCalledWith('lom_insert_rack_chain', 0, 0, 2);
  });

  it('lomSetDrumChainProps substitutes -999 for undefined in/out/choke', async () => {
    await lom.lomSetDrumChainProps(0, 0, 36, 0, 60, undefined, undefined);
    expect(lomCustomCall).toHaveBeenLastCalledWith(
      'lom_set_drum_chain_props',
      0,
      0,
      36,
      0,
      60,
      -999,
      -999,
    );
    await lom.lomSetDrumChainProps(0, 0, 36, 0, undefined, 64, 1);
    expect(lomCustomCall).toHaveBeenLastCalledWith(
      'lom_set_drum_chain_props',
      0,
      0,
      36,
      0,
      -999,
      64,
      1,
    );
  });
});
