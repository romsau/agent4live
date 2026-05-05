'use strict';

// AUTO-AUTHORED — split out from app/server/tools/clips.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

'use strict';

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet, lomCall, lomClearClipEnvelope } = require('../../lom');

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
 * Register the low priority tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── LOW priority clip extras ──

  defineTool(server, {
    name: 'set_clip_legato',
    description:
      "Toggle the Legato Mode switch in the clip's Launch settings. When on, the clip plays in sync with already-playing clips when fired (matches their position) instead of starting from its own start.",
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ track, slot, on }) => lomSet(clipPath(track, slot), 'legato', on ? 1 : 0),
    successText: ({ track, slot, on }) => `Clip [${track},${slot}] legato ${on ? 'on' : 'off'}`,
  });

  defineTool(server, {
    name: 'set_clip_velocity_amount',
    description:
      'Set the clip\'s Velocity Amount (how strongly note velocity affects its volume in this clip). 0.0 = no velocity sensitivity, 1.0 = full. Live\'s "Vel" knob in clip launch settings.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      amount: z.number().min(0).max(1),
    },
    handler: ({ track, slot, amount }) => lomSet(clipPath(track, slot), 'velocity_amount', amount),
    successText: ({ track, slot, amount }) =>
      `Clip [${track},${slot}] velocity amount set to ${amount}`,
  });

  defineTool(server, {
    name: 'set_clip_position',
    description:
      "Move a clip's position in beats. Unlike set_clip_markers (which sets start/end markers separately), this preserves the loop_length / region length — it shifts the clip as a whole.",
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      position: z.number().min(0).describe('New position in beats (preserves length)'),
    },
    handler: ({ track, slot, position }) => lomSet(clipPath(track, slot), 'position', position),
    successText: ({ track, slot, position }) =>
      `Clip [${track},${slot}] position set to ${position}`,
  });

  defineTool(server, {
    name: 'set_clip_signature',
    description:
      'Set per-clip time signature override. Pass numerator and/or denominator. Defaults to song-level signature; setting these overrides for this clip only.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      numerator: z.number().int().min(1).max(99).optional(),
      denominator: z.number().int().min(1).optional().describe('Note value (must be power of 2)'),
    },
    label: ({ track, slot, numerator, denominator }) =>
      `set_clip_signature(${track},${slot},${numerator}/${denominator})`,
    handler: async ({ track, slot, numerator, denominator }) => {
      if (numerator === undefined && denominator === undefined) {
        throw new Error('set_clip_signature: at least one of numerator / denominator required');
      }
      const path = clipPath(track, slot);
      if (numerator !== undefined) await lomSet(path, 'signature_numerator', numerator);
      if (denominator !== undefined) await lomSet(path, 'signature_denominator', denominator);
    },
    successText: ({ track, slot, numerator, denominator }) =>
      `Clip [${track},${slot}] signature ${numerator ?? '?'}/${denominator ?? '?'}`,
  });

  defineTool(server, {
    name: 'clear_clip_envelope',
    description:
      'Remove the automation envelope of ONE specific device parameter from a clip (vs clear_clip_envelopes which clears all). Useful for surgical edits like "keep filter automation, drop volume automation".',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      device_index: z.number().int().min(0).describe("Device index on the clip's track"),
      param_index: z
        .number()
        .int()
        .min(0)
        .describe('Parameter index within the device (from get_device_params)'),
    },
    handler: ({ track, slot, device_index, param_index }) =>
      lomClearClipEnvelope(track, slot, device_index, param_index),
    successText: ({ track, slot, device_index, param_index }) =>
      `Envelope cleared for param ${param_index} of device ${device_index} on clip [${track},${slot}]`,
  });

  defineTool(server, {
    name: 'clear_clip_envelopes',
    description:
      "Remove ALL automation envelopes from a clip (every parameter's automation lane is cleared). Permanent — use undo to revert.",
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
    },
    handler: ({ track, slot }) => lomCall(clipPath(track, slot), 'clear_all_envelopes'),
    successText: ({ track, slot }) => `Clip [${track},${slot}] all envelopes cleared`,
  });

  defineTool(server, {
    name: 'duplicate_clip_loop',
    description:
      'Double the clip\'s loop length and duplicate the notes in the loop region to fill the new space. Same as Live\'s "Duplicate Loop" command. Permanent — use undo to revert.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
    },
    handler: ({ track, slot }) => lomCall(clipPath(track, slot), 'duplicate_loop'),
    successText: ({ track, slot }) => `Clip [${track},${slot}] loop duplicated`,
  });

  defineTool(server, {
    name: 'move_warp_marker',
    description:
      "Move a warp marker to a new beat position. beat_time identifies the marker (must match exactly the marker's current beat_time). distance is the relative move in beats. Use get_warp_markers to discover beat times.",
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      beat_time: z.number().describe('Current beat_time of the marker to move'),
      beat_time_distance: z
        .number()
        .describe('Relative move in beats (positive = later, negative = earlier)'),
    },
    label: ({ track, slot, beat_time, beat_time_distance }) =>
      `move_warp_marker(${track},${slot},${beat_time}+${beat_time_distance})`,
    handler: ({ track, slot, beat_time, beat_time_distance }) =>
      lomCall(clipPath(track, slot), 'move_warp_marker', beat_time, beat_time_distance),
    successText: ({ beat_time, beat_time_distance }) =>
      `Warp marker at beat ${beat_time} moved by ${beat_time_distance}`,
  });

  defineTool(server, {
    name: 'set_clip_loop',
    description:
      'Toggle loop mode on a clip and optionally set the loop start/end markers (in beats). When on=true and start/end are omitted, the existing loop region is kept. When on=false, the clip plays through without looping.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
      on: z.boolean().describe('true = loop, false = play once'),
      start: z.number().min(0).optional().describe('Loop start in beats (optional)'),
      end: z.number().positive().optional().describe('Loop end in beats (optional)'),
    },
    handler: async ({ track, slot, on, start, end }) => {
      const path = clipPath(track, slot);
      await lomSet(path, 'looping', on ? 1 : 0);
      if (on && start !== undefined) await lomSet(path, 'loop_start', start);
      if (on && end !== undefined) await lomSet(path, 'loop_end', end);
    },
    successText: ({ track, slot, on, start, end }) => {
      const range =
        on && (start !== undefined || end !== undefined) ? ` [${start ?? '?'}..${end ?? '?'}]` : '';
      return `Clip at track ${track}, slot ${slot} loop ${on ? 'on' : 'off'}${range}`;
    },
  });
}

module.exports = { register };
