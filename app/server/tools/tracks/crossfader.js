'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet } = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.
const trackPath = (track) => `live_set tracks ${track}`;
const mixerPath = (track) => `${trackPath(track)} mixer_device`;
const returnPath = (idx) => `live_set return_tracks ${idx}`;
const returnMixerPath = (idx) => `${returnPath(idx)} mixer_device`;
const masterMixerPath = 'live_set master_track mixer_device';

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the crossfader tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Crossfader ──

  defineTool(server, {
    name: 'set_crossfader',
    description:
      'Set the master crossfader position. value -1.0 = full A, +1.0 = full B, 0.0 = center (both audible). Crossfader interpolates between tracks assigned to A vs B (use set_track_crossfade_assign / set_return_crossfade_assign).',
    schema: { value: z.number().min(-1).max(1).describe('-1.0 (A) to +1.0 (B), 0.0 = center') },
    handler: ({ value }) => lomSet(`${masterMixerPath} crossfader`, 'value', value),
    successText: ({ value }) => `Crossfader set to ${value}`,
  });

  defineTool(server, {
    name: 'set_track_crossfade_assign',
    description:
      'Assign a regular track to one of the crossfader sides. assign: 0 = A, 1 = None, 2 = B. Tracks assigned to A or B are interpolated by the master crossfader; None means always audible (default).',
    schema: {
      track: z.number().int().min(0),
      assign: z.number().int().min(0).max(2).describe('0=A, 1=None, 2=B'),
    },
    handler: ({ track, assign }) => lomSet(mixerPath(track), 'crossfade_assign', assign),
    successText: ({ track, assign }) => `Track ${track} crossfade assign set to ${assign}`,
  });

  defineTool(server, {
    name: 'set_return_crossfade_assign',
    description:
      'Assign a return track to one of the crossfader sides. Same enum as set_track_crossfade_assign: 0=A, 1=None, 2=B.',
    schema: {
      return_index: z.number().int().min(0),
      assign: z.number().int().min(0).max(2),
    },
    handler: ({ return_index, assign }) =>
      lomSet(returnMixerPath(return_index), 'crossfade_assign', assign),
    successText: ({ return_index, assign }) =>
      `Return ${return_index} crossfade assign set to ${assign}`,
  });
}

module.exports = { register };
