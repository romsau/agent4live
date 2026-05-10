'use strict';

// Public LOM API — every tool in tools/ imports from here.
// Each helper wraps `enqueue(() => lomOp/lomCustomCall(...))` so the queue
// serializes calls regardless of which surface the caller uses.
//
// Two surfaces :
//   - lomGet / lomSet / lomCall → generic LOM ops, routed by lom_request()
//     in lom_router.js. Use these whenever a tool just touches a property
//     or invokes a method on a LOM path.
//   - lomXxx (dedicated names) → bespoke handlers in lom_router.js. Use
//     these when the op needs custom logic (Dict construction, multi-step
//     LOM calls, JSON serialization beyond a single value, etc.).

const { enqueue } = require('./queue');
const { lomOp, lomCustomCall } = require('./transport');

const lomGet = (lomPath, prop) => enqueue(() => lomOp('get', lomPath, prop));
const lomSet = (lomPath, prop, value) => enqueue(() => lomOp('set', lomPath, prop, value));
const lomCall = (lomPath, method, ...args) =>
  enqueue(() => lomOp('call', lomPath, method, ...args));

// Thin helper: serialize + queue-wrap one named outlet call.
const callDedicated = (opName, ...args) => enqueue(() => lomCustomCall(opName, ...args));

// ── Notes editing ────────────────────────────────────────────────────────
const lomAddClip = (track, slot, length, notesJson) =>
  callDedicated('lom_add_clip', track, slot, length, notesJson);
const lomGetClipNotes = (track, slot, fromPitch, pitchSpan, fromTime, timeSpan) =>
  callDedicated('lom_get_clip_notes', track, slot, fromPitch, pitchSpan, fromTime, timeSpan);
const lomReplaceClipNotes = (track, slot, notesJson) =>
  callDedicated('lom_replace_clip_notes', track, slot, notesJson);
const lomApplyNoteModifications = (track, slot, notesJson) =>
  callDedicated('lom_apply_note_modifications', track, slot, notesJson);
const lomGetAllNotes = (track, slot) => callDedicated('lom_get_all_notes', track, slot);
const lomGetSelectedNotes = (track, slot) => callDedicated('lom_get_selected_notes', track, slot);
const lomGetNotesById = (track, slot, idsJson) =>
  callDedicated('lom_get_notes_by_id', track, slot, idsJson);
const lomAddNotesToClip = (track, slot, notesJson) =>
  callDedicated('lom_add_notes_to_clip', track, slot, notesJson);
const lomRemoveNotesById = (track, slot, idsJson) =>
  callDedicated('lom_remove_notes_by_id', track, slot, idsJson);
const lomDuplicateNotesById = (track, slot, paramsJson) =>
  callDedicated('lom_duplicate_notes_by_id', track, slot, paramsJson);

// ── Audio clips ──────────────────────────────────────────────────────────
const lomGetClipAudioInfo = (track, slot) => callDedicated('lom_get_clip_audio_info', track, slot);
const lomGetWarpMarkers = (track, slot) => callDedicated('lom_get_warp_markers', track, slot);
const lomAddWarpMarker = (track, slot, beatTime, sampleTime) =>
  // Router treats NaN as "not provided" (Max [js] can't differentiate
  // undefined from no-arg over the outlet, but it can detect NaN).
  callDedicated(
    'lom_add_warp_marker',
    track,
    slot,
    beatTime === undefined ? NaN : beatTime,
    sampleTime === undefined ? NaN : sampleTime,
  );
const lomClearClipEnvelope = (track, slot, deviceIdx, paramIdx) =>
  callDedicated('lom_clear_clip_envelope', track, slot, deviceIdx, paramIdx);
const lomDuplicateClipToSlot = (sourceTrack, sourceSlot, destTrack, destSlot) =>
  callDedicated('lom_duplicate_clip_to_slot', sourceTrack, sourceSlot, destTrack, destSlot);
const lomDuplicateClipToArrangement = (track, slot, destTime) =>
  callDedicated('lom_duplicate_clip_to_arrangement', track, slot, destTime);
const lomDeleteArrangementClip = (track, arrIdx) =>
  callDedicated('lom_delete_arrangement_clip', track, arrIdx);

// ── Cue points ───────────────────────────────────────────────────────────
const lomGetCuePoints = () => callDedicated('lom_get_cue_points');
const lomSetCuePointName = (idx, name) => callDedicated('lom_set_cue_point_name', idx, name);
const lomSetCuePointTime = (idx, time) => callDedicated('lom_set_cue_point_time', idx, time);
const lomJumpToCue = (idx) => callDedicated('lom_jump_to_cue', idx);

// ── Tracks / devices / params ────────────────────────────────────────────
const lomGetTrackDevices = (track) => callDedicated('lom_get_track_devices', track);
const lomGetDeviceParams = (track, deviceIdx) =>
  callDedicated('lom_get_device_params', track, deviceIdx);
const lomGetTrackGroupInfo = (track) => callDedicated('lom_get_track_group_info', track);
const lomGetTakeLanes = (track) => callDedicated('lom_get_take_lanes', track);
const lomMoveDevice = (fromTrack, fromIdx, toTrack, toPos) =>
  callDedicated('lom_move_device', fromTrack, fromIdx, toTrack, toPos);
const lomSetTrackRouting = (track, propName, identifier) =>
  callDedicated('lom_set_track_routing', track, propName, identifier);
const lomGetTrackRouting = (track, side) => callDedicated('lom_get_track_routing', track, side);
const lomGetDeviceIoRoutings = (track, deviceIdx) =>
  callDedicated('lom_get_device_io_routings', track, deviceIdx);
const lomSetDeviceIoRoutingType = (track, deviceIdx, ioType, ioIdx, identifier) =>
  callDedicated('lom_set_device_io_routing_type', track, deviceIdx, ioType, ioIdx, identifier);
const lomSetDeviceIoRoutingChannel = (track, deviceIdx, ioType, ioIdx, identifier) =>
  callDedicated('lom_set_device_io_routing_channel', track, deviceIdx, ioType, ioIdx, identifier);

// ── Racks (regular + drum) ───────────────────────────────────────────────
const lomGetRackChains = (track, deviceIdx) =>
  callDedicated('lom_get_rack_chains', track, deviceIdx);
const lomGetDrumPads = (track, deviceIdx, onlyVisible) =>
  callDedicated('lom_get_drum_pads', track, deviceIdx, onlyVisible ? 1 : 0);
const lomGetChainDevices = (track, deviceIdx, chainIdx) =>
  callDedicated('lom_get_chain_devices', track, deviceIdx, chainIdx);
const lomGetDrumPadChains = (track, deviceIdx, padIdx) =>
  callDedicated('lom_get_drum_pad_chains', track, deviceIdx, padIdx);
const lomGetDrumPadChainDevices = (track, deviceIdx, padIdx, chainIdx) =>
  callDedicated('lom_get_drum_pad_chain_devices', track, deviceIdx, padIdx, chainIdx);
const lomGetChainDeviceParams = (track, deviceIdx, chainIdx, subDeviceIdx) =>
  callDedicated('lom_get_chain_device_params', track, deviceIdx, chainIdx, subDeviceIdx);
const lomGetDrumPadChainDeviceParams = (track, deviceIdx, padIdx, chainIdx, subDeviceIdx) =>
  callDedicated(
    'lom_get_drum_pad_chain_device_params',
    track,
    deviceIdx,
    padIdx,
    chainIdx,
    subDeviceIdx,
  );
const lomGetRackMacros = (track, deviceIdx) =>
  callDedicated('lom_get_rack_macros', track, deviceIdx);
const lomAddRackMacro = (track, deviceIdx) => callDedicated('lom_add_rack_macro', track, deviceIdx);
const lomRemoveRackMacro = (track, deviceIdx) =>
  callDedicated('lom_remove_rack_macro', track, deviceIdx);
const lomRandomizeRackMacros = (track, deviceIdx) =>
  callDedicated('lom_randomize_rack_macros', track, deviceIdx);
const lomStoreRackVariation = (track, deviceIdx) =>
  callDedicated('lom_store_rack_variation', track, deviceIdx);
const lomRecallRackVariation = (track, deviceIdx, variationIdx) =>
  // -1 means "recall currently selected variation" on the router side.
  callDedicated(
    'lom_recall_rack_variation',
    track,
    deviceIdx,
    variationIdx === undefined ? -1 : variationIdx,
  );
const lomRecallLastUsedVariation = (track, deviceIdx) =>
  callDedicated('lom_recall_last_used_variation', track, deviceIdx);
const lomDeleteRackVariation = (track, deviceIdx) =>
  callDedicated('lom_delete_rack_variation', track, deviceIdx);
const lomInsertRackChain = (track, deviceIdx, position) =>
  // -1 means "append at end" on the router side.
  callDedicated('lom_insert_rack_chain', track, deviceIdx, position === undefined ? -1 : position);
const lomCopyDrumPad = (track, deviceIdx, src, dst) =>
  callDedicated('lom_copy_drum_pad', track, deviceIdx, src, dst);
const lomSetDrumChainProps = (track, deviceIdx, padIdx, chainIdx, inNote, outNote, choke) =>
  // -999 means "leave unchanged" for each prop on the router side.
  callDedicated(
    'lom_set_drum_chain_props',
    track,
    deviceIdx,
    padIdx,
    chainIdx,
    inNote === undefined ? -999 : inNote,
    outNote === undefined ? -999 : outNote,
    choke === undefined ? -999 : choke,
  );

// ── Session / global ─────────────────────────────────────────────────────
const lomSessionState = () => callDedicated('lom_session_state');
const lomScanPeers = () => callDedicated('lom_scan_peers');
const lomGetScale = () => callDedicated('lom_get_scale');
const lomGetSelection = () => callDedicated('lom_get_selection');
const lomSelectTrack = (track) => callDedicated('lom_select_track', track);
const lomSelectScene = (scene) => callDedicated('lom_select_scene', scene);
const lomSelectDevice = (track, device) => callDedicated('lom_select_device', track, device);
const lomGetGrooves = () => callDedicated('lom_get_grooves');
const lomSetClipGroove = (track, slot, grooveIdx) =>
  callDedicated('lom_set_clip_groove', track, slot, grooveIdx);
const lomGetControlSurfaces = () => callDedicated('lom_get_control_surfaces');
const lomGetControlSurfaceControls = (surfaceIdx) =>
  callDedicated('lom_get_control_surface_controls', surfaceIdx);

// ── Observers (used by sse.js for push notifications) ────────────────────
const lomObserve = (path, prop, throttleMs) => callDedicated('lom_observe', path, prop, throttleMs);
const lomUnobserve = (observerId) => callDedicated('lom_unobserve', observerId);

module.exports = {
  // generic
  lomGet,
  lomSet,
  lomCall,
  // notes
  lomAddClip,
  lomGetClipNotes,
  lomReplaceClipNotes,
  lomApplyNoteModifications,
  lomGetAllNotes,
  lomGetSelectedNotes,
  lomGetNotesById,
  lomAddNotesToClip,
  lomRemoveNotesById,
  lomDuplicateNotesById,
  // audio clips
  lomGetClipAudioInfo,
  lomGetWarpMarkers,
  lomAddWarpMarker,
  lomClearClipEnvelope,
  lomDuplicateClipToSlot,
  lomDuplicateClipToArrangement,
  lomDeleteArrangementClip,
  // cue points
  lomGetCuePoints,
  lomSetCuePointName,
  lomSetCuePointTime,
  lomJumpToCue,
  // tracks / devices / params
  lomGetTrackDevices,
  lomGetDeviceParams,
  lomGetTrackGroupInfo,
  lomGetTakeLanes,
  lomMoveDevice,
  lomSetTrackRouting,
  lomGetTrackRouting,
  lomGetDeviceIoRoutings,
  lomSetDeviceIoRoutingType,
  lomSetDeviceIoRoutingChannel,
  // racks
  lomGetRackChains,
  lomGetDrumPads,
  lomGetChainDevices,
  lomGetDrumPadChains,
  lomGetDrumPadChainDevices,
  lomGetChainDeviceParams,
  lomGetDrumPadChainDeviceParams,
  lomGetRackMacros,
  lomAddRackMacro,
  lomRemoveRackMacro,
  lomRandomizeRackMacros,
  lomStoreRackVariation,
  lomRecallRackVariation,
  lomRecallLastUsedVariation,
  lomDeleteRackVariation,
  lomInsertRackChain,
  lomCopyDrumPad,
  lomSetDrumChainProps,
  // session / global
  lomSessionState,
  lomScanPeers,
  lomGetScale,
  lomGetSelection,
  lomSelectTrack,
  lomSelectScene,
  lomSelectDevice,
  lomGetGrooves,
  lomSetClipGroove,
  lomGetControlSurfaces,
  lomGetControlSurfaceControls,
  // observers
  lomObserve,
  lomUnobserve,
};
