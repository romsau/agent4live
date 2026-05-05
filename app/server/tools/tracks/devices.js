'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomMoveDevice } = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the move device tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Move device ──

  defineTool(server, {
    name: 'move_device',
    description:
      "Move a device from one track to another (or reorder within the same track). target_position is the index in the destination track's device chain. Live snaps to the nearest valid position if the requested one is invalid (e.g. trying to insert a MIDI Effect after an instrument). Use undo to revert.",
    schema: {
      from_track: z.number().int().min(0),
      from_device_index: z.number().int().min(0),
      to_track: z.number().int().min(0),
      to_position: z
        .number()
        .int()
        .min(0)
        .describe("Target index in the destination track's device chain"),
    },
    label: ({ from_track, from_device_index, to_track, to_position }) =>
      `move_device(${from_track},${from_device_index}→${to_track},${to_position})`,
    handler: ({ from_track, from_device_index, to_track, to_position }) =>
      lomMoveDevice(from_track, from_device_index, to_track, to_position),
    successText: ({ from_track, from_device_index, to_track, to_position }) =>
      `Device ${from_device_index} on track ${from_track} moved to track ${to_track} pos ${to_position}`,
  });
}

module.exports = { register };
