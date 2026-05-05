'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet, lomCall, lomGetTakeLanes } = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.
const trackPath = (track) => `live_set tracks ${track}`;

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the take lanes tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Take lanes (Live 12+) ──

  defineTool(server, {
    name: 'create_take_lane',
    description:
      'Create a new (empty) take lane on a track. Live 12+. Take lanes appear in Arrangement View when "Show Take Lanes" is enabled (right-click on track header).',
    schema: { track: z.number().int().min(0) },
    handler: ({ track }) => lomCall(trackPath(track), 'create_take_lane'),
    successText: ({ track }) => `Take lane created on track ${track}`,
  });

  defineTool(server, {
    name: 'get_take_lanes',
    description:
      'List all take lanes on a track. Returns JSON [{index, name}, ...]. Use the index for set_take_lane_name and arrangement_clips access via raw lom_get on path "live_set tracks N take_lanes M arrangement_clips".',
    schema: { track: z.number().int().min(0) },
    handler: ({ track }) => lomGetTakeLanes(track),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_take_lane_name',
    description: 'Rename a take lane on a track.',
    schema: {
      track: z.number().int().min(0),
      lane_index: z.number().int().min(0),
      name: z.string(),
    },
    handler: ({ track, lane_index, name }) =>
      lomSet(`${trackPath(track)} take_lanes ${lane_index}`, 'name', name),
    successText: ({ track, lane_index, name }) =>
      `Take lane ${lane_index} on track ${track} renamed to "${name}"`,
  });
}

module.exports = { register };
