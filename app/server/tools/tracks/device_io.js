'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const {
  lomSet,
  lomCall,
  lomGetDeviceIoRoutings,
  lomSetDeviceIoRoutingType,
  lomSetDeviceIoRoutingChannel,
} = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.
const trackPath = (track) => `live_set tracks ${track}`;
const devicePath = (track, device_index) => `${trackPath(track)} devices ${device_index}`;

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the deviceio routings tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── DeviceIO routings (Max for Live + plugin devices) ──

  defineTool(server, {
    name: 'get_device_io_routings',
    description:
      "Read all I/O routings of a Max for Live or plugin device. Returns JSON: { audio_inputs: [...], audio_outputs: [...], midi_inputs: [...], midi_outputs: [...] }. Each entry: { index, routing_type, routing_channel, available_types, available_channels }. Empty arrays for native devices that don't expose extra I/O.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
    },
    handler: ({ track, device_index }) => lomGetDeviceIoRoutings(track, device_index),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_device_io_routing_type',
    description:
      'Set the routing type of a specific I/O bus on a Max for Live or plugin device. io_type identifies the bus list: "audio_in" | "audio_out" | "midi_in" | "midi_out". io_index is the index in that list. identifier must match an entry in the bus\'s available_routing_types — use get_device_io_routings to discover.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      io_type: z.enum(['audio_in', 'audio_out', 'midi_in', 'midi_out']),
      io_index: z.number().int().min(0),
      identifier: z.union([z.string(), z.number()]),
    },
    handler: ({ track, device_index, io_type, io_index, identifier }) =>
      lomSetDeviceIoRoutingType(track, device_index, io_type, io_index, identifier),
    successText: ({ io_type, io_index }) => `${io_type}[${io_index}] type set`,
  });

  defineTool(server, {
    name: 'set_device_io_routing_channel',
    description:
      'Set the routing channel of a specific I/O bus. Same args structure as set_device_io_routing_type but for the channel field.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      io_type: z.enum(['audio_in', 'audio_out', 'midi_in', 'midi_out']),
      io_index: z.number().int().min(0),
      identifier: z.union([z.string(), z.number()]),
    },
    handler: ({ track, device_index, io_type, io_index, identifier }) =>
      lomSetDeviceIoRoutingChannel(track, device_index, io_type, io_index, identifier),
    successText: ({ io_type, io_index }) => `${io_type}[${io_index}] channel set`,
  });

  defineTool(server, {
    name: 'save_device_compare_ab',
    description:
      "Save the device's current state to the alternate A/B compare slot, so you can revert/compare via the device's compare button. Live 12.3+. Errors silently if the device doesn't support compare A/B (check Device.can_compare_ab via raw lom_get if unsure).",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
    },
    handler: ({ track, device_index }) =>
      lomCall(devicePath(track, device_index), 'save_preset_to_compare_ab_slot'),
    successText: ({ track, device_index }) =>
      `Device ${device_index} on track ${track} state saved to compare A/B`,
  });

  defineTool(server, {
    name: 're_enable_param_automation',
    description:
      "Re-enable automation for ONE specific device parameter on a track (per-param variant of the global re_enable_automation). Useful when you've overridden a single param via set_device_param and want to put it back under automation control without affecting the rest.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      param_index: z.number().int().min(0),
    },
    handler: ({ track, device_index, param_index }) =>
      lomCall(
        `${devicePath(track, device_index)} parameters ${param_index}`,
        're_enable_automation',
      ),
    successText: ({ track, device_index, param_index }) =>
      `Param ${param_index} of device ${device_index} on track ${track} automation re-enabled`,
  });

  defineTool(server, {
    name: 'create_take_lane_midi_clip',
    description:
      'Create an empty MIDI clip on a take lane in Arrangement (Live 12+). Different from create_arrangement_midi_clip (which uses the main track lane). Throws on non-MIDI tracks or if start_time is out of range.',
    schema: {
      track: z.number().int().min(0),
      take_lane_index: z.number().int().min(0),
      start_time: z.number().min(0).describe('Position in beats from arrangement start'),
      length: z.number().positive().describe('Clip length in beats'),
    },
    handler: ({ track, take_lane_index, start_time, length }) =>
      lomCall(
        `${trackPath(track)} take_lanes ${take_lane_index}`,
        'create_midi_clip',
        start_time,
        length,
      ),
    successText: ({ track, take_lane_index, start_time }) =>
      `MIDI clip created on track ${track}, take lane ${take_lane_index} at beat ${start_time}`,
  });

  defineTool(server, {
    name: 'create_take_lane_audio_clip',
    description:
      'Create an audio clip on a take lane in Arrangement (Live 12+) by referencing an audio file on disk. Audio tracks only.',
    schema: {
      track: z.number().int().min(0),
      take_lane_index: z.number().int().min(0),
      file_path: z.string().describe('Absolute path to a valid audio file'),
      start_time: z.number().min(0),
    },
    handler: ({ track, take_lane_index, file_path, start_time }) =>
      lomCall(
        `${trackPath(track)} take_lanes ${take_lane_index}`,
        'create_audio_clip',
        file_path,
        start_time,
      ),
    successText: ({ track, take_lane_index, start_time }) =>
      `Audio clip created on track ${track}, take lane ${take_lane_index} at beat ${start_time}`,
  });

  defineTool(server, {
    name: 'set_device_active',
    description:
      'Toggle a device on/off (the device activator switch). When on=false the device is bypassed (no audio processing). Note: Device.is_active is a derived read-only property in the LOM ; the activator is actually parameter 0 ("Device On") of the device. This tool sets that parameter.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      on: z.boolean().describe('true = active (processing), false = bypassed'),
    },
    handler: ({ track, device_index, on }) =>
      lomSet(`${devicePath(track, device_index)} parameters 0`, 'value', on ? 1 : 0),
    successText: ({ track, device_index, on }) =>
      `Device ${device_index} on track ${track} ${on ? 'active' : 'bypassed'}`,
  });

  defineTool(server, {
    name: 'insert_device',
    description:
      'Insert a native Ableton device on a track at a given position (or at the end if target_index omitted). Live 12.3+ only. device_name must match the device\'s name as shown in Live\'s UI (e.g. "Drum Rack", "Operator", "EQ Eight", "Compressor", "Reverb"). Native devices only — Max for Live devices and VST/AU plugins are NOT supported by this LOM API. Throws if insertion is not allowed (e.g. inserting a MIDI Effect after an instrument). IMPORTANT: unknown device_name values silently no-op without error — always read back via get_track_devices after calling.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      device_name: z
        .string()
        .describe('Native device name as shown in Live UI (e.g. "Drum Rack", "Operator")'),
      target_index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Insert position (omit = end of chain)'),
    },
    handler: ({ track, device_name, target_index }) =>
      target_index === undefined
        ? lomCall(trackPath(track), 'insert_device', device_name)
        : lomCall(trackPath(track), 'insert_device', device_name, target_index),
    successText: ({ track, device_name, target_index }) =>
      `Inserted "${device_name}" on track ${track}${target_index !== undefined ? ` at ${target_index}` : ''}`,
  });

  defineTool(server, {
    name: 'delete_device',
    description:
      "Remove a device from a track's device chain by its index. Live 12.3+. Use get_track_devices to find the index first. Cannot be undone via this tool — use the undo tool to restore (mind the undo caveats).",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      device_index: z
        .number()
        .int()
        .min(0)
        .describe('Device index to delete (from get_track_devices)'),
    },
    handler: ({ track, device_index }) => lomCall(trackPath(track), 'delete_device', device_index),
    successText: ({ track, device_index }) => `Deleted device ${device_index} on track ${track}`,
  });
}

module.exports = { register };
