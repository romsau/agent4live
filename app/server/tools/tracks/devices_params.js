'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet, lomSetTrackRouting, lomGetTrackDevices, lomGetDeviceParams } = require('../../lom');

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
 * Register the devices + parameters tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Devices + parameters ──

  defineTool(server, {
    name: 'get_track_devices',
    description:
      'List the devices on a track in chain order. Returns JSON: [{index, name, class_name}, ...]. The index is the position to use in get_device_params / set_device_param. class_name is the LOM device type (e.g. "Operator", "Compressor2", "MxDeviceAudioEffect", "PluginDevice"). Use the returned index — name can be edited by the user, class_name is stable.',
    schema: { track: z.number().int().min(0).describe('Track index (0-based)') },
    handler: ({ track }) => lomGetTrackDevices(track),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_device_params',
    description:
      'List all automatable parameters of a device. Returns JSON: [{index, name, value, min, max, is_quantized, is_enabled, value_items?}, ...]. value is the current numeric value; min/max are the LOM range. is_quantized=true means the parameter is a discrete enum/bool (value_items lists the labels at indices 0..N). is_enabled=false means the parameter is locked by Live (e.g. macro-mapped or modulated) and set_device_param will silently no-op.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      device_index: z
        .number()
        .int()
        .min(0)
        .describe('Device index (0-based, from get_track_devices)'),
    },
    handler: ({ track, device_index }) => lomGetDeviceParams(track, device_index),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_device_param',
    description:
      "Set a single device parameter's value. Pass a number in [min, max] (Live clamps silently if out of range). For is_quantized parameters, value is the discrete index (0..N-1, see value_items in get_device_params). Read-only or disabled parameters silently no-op — read back via get_device_params to verify. For automated parameters this writes the static value but the automation will override on playback unless re_enable_automation is on.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      device_index: z.number().int().min(0).describe('Device index (0-based)'),
      param_index: z
        .number()
        .int()
        .min(0)
        .describe('Parameter index (0-based, from get_device_params)'),
      value: z.number().describe('New parameter value (Live clamps to [min, max])'),
    },
    handler: ({ track, device_index, param_index, value }) =>
      lomSet(`${devicePath(track, device_index)} parameters ${param_index}`, 'value', value),
    successText: ({ track, device_index, param_index, value }) =>
      `Parameter ${param_index} of device ${device_index} on track ${track} set to ${value}`,
  });

  defineTool(server, {
    name: 'set_track_output_channel',
    description:
      "Set a track's output destination channel within the current output type (e.g. specific stereo pair, send slot). Valid channels depend on the type — call get_track_output_routing first.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      identifier: z
        .union([z.string(), z.number()])
        .describe('Routing channel identifier (from get_track_output_routing.available)'),
    },
    handler: ({ track, identifier }) =>
      lomSetTrackRouting(track, 'output_routing_channel', identifier),
    successText: ({ track }) => `Track ${track} output channel set`,
  });
}

module.exports = { register };
