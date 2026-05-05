'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSetTrackRouting, lomGetTrackRouting } = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the routing (input/output tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Routing (input/output type + channel) ──
  // input_routing_* is only available on MIDI/audio tracks (not return/master).
  // output_routing_* is available on every track except master.
  // Both are dictionary properties — set by passing { identifier } (must
  // match an entry from the corresponding available_* list). Always call
  // get_track_input_routing / get_track_output_routing first to discover
  // valid identifiers — they're opaque strings computed by Live and depend
  // on what's around the track (other tracks, devices, audio interface).

  defineTool(server, {
    name: 'get_track_input_routing',
    description:
      'Read a track\'s input routing: current type + channel, and the lists of available choices. Returns JSON: { type: {current: {display_name, identifier}, available: [...]}, channel: {current, available} }. The "available" lists may be empty on some Live versions — in that case, use the "current" identifier as a starting point or refer to the user. Only meaningful on MIDI/audio tracks (return/master have no input).',
    schema: { track: z.number().int().min(0).describe('Track index (0-based, MIDI or audio)') },
    handler: ({ track }) => lomGetTrackRouting(track, 'input'),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_track_output_routing',
    description:
      "Read a track's output routing: current type + channel, and the lists of available choices. Same JSON shape as get_track_input_routing. Available on every track except master.",
    schema: { track: z.number().int().min(0).describe('Track index (0-based)') },
    handler: ({ track }) => lomGetTrackRouting(track, 'output'),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_track_input_type',
    description:
      'Set a track\'s input source type (e.g. "Ext. In", "All Ins", "No Input", "<other track name>"). The identifier is opaque — call get_track_input_routing first to list valid identifiers for this track. Only on MIDI/audio tracks. Changing the type may invalidate the current channel — re-check channel after.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based, MIDI or audio)'),
      identifier: z
        .union([z.string(), z.number()])
        .describe('Routing type identifier (from get_track_input_routing.available)'),
    },
    handler: ({ track, identifier }) => lomSetTrackRouting(track, 'input_routing_type', identifier),
    successText: ({ track }) => `Track ${track} input type set`,
  });

  defineTool(server, {
    name: 'set_track_input_channel',
    description:
      "Set a track's input source channel within the current input type (e.g. specific MIDI channel, audio sub-input, or pre/post-FX of another track). The valid channels depend on the type — call get_track_input_routing first. Only on MIDI/audio tracks.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based, MIDI or audio)'),
      identifier: z
        .union([z.string(), z.number()])
        .describe('Routing channel identifier (from get_track_input_routing.available)'),
    },
    handler: ({ track, identifier }) =>
      lomSetTrackRouting(track, 'input_routing_channel', identifier),
    successText: ({ track }) => `Track ${track} input channel set`,
  });

  defineTool(server, {
    name: 'set_track_output_type',
    description:
      'Set a track\'s output destination type (e.g. "Master", "Ext. Out", "<send return>", "<other track>"). The identifier is opaque — call get_track_output_routing first. Available on every track except master.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      identifier: z
        .union([z.string(), z.number()])
        .describe('Routing type identifier (from get_track_output_routing.available)'),
    },
    handler: ({ track, identifier }) =>
      lomSetTrackRouting(track, 'output_routing_type', identifier),
    successText: ({ track }) => `Track ${track} output type set`,
  });
}

module.exports = { register };
