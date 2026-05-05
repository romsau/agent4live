'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet, lomCall } = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.
const returnPath = (idx) => `live_set return_tracks ${idx}`;
const returnMixerPath = (idx) => `${returnPath(idx)} mixer_device`;

const colorHex = (color) => `0x${color.toString(16).toUpperCase().padStart(6, '0')}`;

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the return tracks tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Return tracks ──

  defineTool(server, {
    name: 'set_return_volume',
    description:
      "Set a return track's volume. Returns are indexed 0-based starting from the first return (A, B, C…). Same 0.0-1.0 range.",
    schema: {
      return_index: z.number().int().min(0).describe('Return track index (0 = first, A)'),
      value: z.number().min(0).max(1),
    },
    handler: ({ return_index, value }) =>
      lomSet(`${returnMixerPath(return_index)} volume`, 'value', value),
    successText: ({ return_index, value }) => `Return ${return_index} volume set to ${value}`,
  });

  defineTool(server, {
    name: 'set_return_panning',
    description: "Set a return track's pan. -1.0 to 1.0.",
    schema: {
      return_index: z.number().int().min(0),
      value: z.number().min(-1).max(1),
    },
    handler: ({ return_index, value }) =>
      lomSet(`${returnMixerPath(return_index)} panning`, 'value', value),
    successText: ({ return_index, value }) => `Return ${return_index} pan set to ${value}`,
  });

  defineTool(server, {
    name: 'set_return_send',
    description:
      "Set the level of a return track's send to another return track (return-to-return routing). send_index targets the position in the returns list. Returns can be sent to other returns of higher index only (Live constraint).",
    schema: {
      return_index: z.number().int().min(0).describe('Source return track index'),
      send_index: z.number().int().min(0).describe('Destination return index in sends list'),
      value: z.number().min(0).max(1),
    },
    handler: ({ return_index, send_index, value }) =>
      lomSet(`${returnMixerPath(return_index)} sends ${send_index}`, 'value', value),
    successText: ({ return_index, send_index, value }) =>
      `Return ${return_index} send ${send_index} set to ${value}`,
  });

  defineTool(server, {
    name: 'set_return_mute',
    description: 'Mute or unmute a return track.',
    schema: {
      return_index: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ return_index, on }) => lomSet(returnPath(return_index), 'mute', on ? 1 : 0),
    successText: ({ return_index, on }) => `Return ${return_index} ${on ? 'muted' : 'unmuted'}`,
  });

  defineTool(server, {
    name: 'set_return_solo',
    description:
      "Solo or unsolo a return track. Live's exclusive_solo setting determines whether this unsolos others.",
    schema: {
      return_index: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ return_index, on }) => lomSet(returnPath(return_index), 'solo', on ? 1 : 0),
    successText: ({ return_index, on }) => `Return ${return_index} ${on ? 'soloed' : 'un-soloed'}`,
  });

  defineTool(server, {
    name: 'set_return_name',
    description:
      'Rename a return track. Live 12 auto-prefixes returns with their letter (A-, B-, C-…) at display time — pass just the suffix you want (e.g. "Reverb") and Live shows "A-Reverb". The LOM stores the value as you set it.',
    schema: {
      return_index: z.number().int().min(0),
      name: z.string(),
    },
    handler: ({ return_index, name }) => lomSet(returnPath(return_index), 'name', name),
    successText: ({ return_index, name }) => `Return ${return_index} renamed to "${name}"`,
  });

  defineTool(server, {
    name: 'set_return_color',
    description: "Set a return track's color (24-bit RGB integer 0xRRGGBB).",
    schema: {
      return_index: z.number().int().min(0),
      color: z.number().int().min(0).max(0xffffff),
    },
    handler: ({ return_index, color }) => lomSet(returnPath(return_index), 'color', color),
    successText: ({ return_index, color }) =>
      `Return ${return_index} color set to ${colorHex(color)}`,
  });

  defineTool(server, {
    name: 'delete_return_track',
    description:
      'Delete a return track by index. Sends from regular tracks to this return are also removed. Cannot be undone via this tool — use the undo tool to restore.',
    schema: { return_index: z.number().int().min(0).describe('Return track index to delete') },
    handler: ({ return_index }) => lomCall('live_set', 'delete_return_track', return_index),
    successText: ({ return_index }) => `Return ${return_index} deleted`,
  });
}

module.exports = { register };
