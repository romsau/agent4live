'use strict';

// AUTO-AUTHORED — split out from app/server/tools/clips.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

'use strict';

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomCall } = require('../../lom');

// LOM path helpers — every clip operation either targets the clip slot
// (create / delete / duplicate) or the clip itself (everything else).
const slotPath = (track, slot) => `live_set tracks ${track} clip_slots ${slot}`;
const clipPath = (track, slot) => `${slotPath(track, slot)} clip`;

// Reusable Zod sub-schema for note arrays passed to add_notes_to_clip /
// replace_clip_notes / add_clip — each tool tweaks slightly so we keep the
// constructors local rather than freezing one shape.

/**
 * Register the clip tools: creation (Arrangement + Session, MIDI + audio),
 * note manipulation, audio inspection, warp markers, envelopes.
 *
 * @param {object} server
 */

/**
 * Register the clip navigation tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Clip navigation (relative) ──

  defineTool(server, {
    name: 'move_playing_pos',
    description:
      "Jump by a relative beat amount in a clip that's currently playing. Unquantized. Negative beats jump backwards. No-op if the clip isn't playing.",
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      beats: z.number().describe('Relative jump in beats'),
    },
    handler: ({ track, slot, beats }) => lomCall(clipPath(track, slot), 'move_playing_pos', beats),
    successText: ({ track, slot, beats }) =>
      `Clip [${track},${slot}] playing pos moved by ${beats} beats`,
  });

  defineTool(server, {
    name: 'scrub_clip',
    description:
      'Scrub a clip to a target beat_time. Behaves like dragging the playback marker with the mouse — respects Global Quantization, starts and loops in time with the transport. Continues until stop_scrub_clip is called.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      beat_time: z.number().min(0).describe('Target beat time in the clip'),
    },
    handler: ({ track, slot, beat_time }) => lomCall(clipPath(track, slot), 'scrub', beat_time),
    successText: ({ track, slot, beat_time }) =>
      `Clip [${track},${slot}] scrubbing to beat ${beat_time}`,
  });

  defineTool(server, {
    name: 'stop_scrub_clip',
    description: 'Stop an active scrub on a clip (started by scrub_clip).',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
    },
    handler: ({ track, slot }) => lomCall(clipPath(track, slot), 'stop_scrub'),
    successText: ({ track, slot }) => `Clip [${track},${slot}] scrub stopped`,
  });
}

module.exports = { register };
