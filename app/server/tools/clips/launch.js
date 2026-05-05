'use strict';

// AUTO-AUTHORED — split out from app/server/tools/clips.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

'use strict';

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet } = require('../../lom');

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
 * Register the clip launch settings tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Clip launch settings ──

  defineTool(server, {
    name: 'set_clip_launch_mode',
    description:
      'Set how the clip responds to launch. Enum: 0=Trigger (default — fire from start, play through), 1=Gate (play while held, stop on release), 2=Toggle (alternate fire/stop), 3=Repeat (re-fire on each Note On). Per-clip override of the global Live launch behavior.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      mode: z.number().int().min(0).max(3).describe('0=Trigger, 1=Gate, 2=Toggle, 3=Repeat'),
    },
    handler: ({ track, slot, mode }) => lomSet(clipPath(track, slot), 'launch_mode', mode),
    successText: ({ mode }) => `Clip launch mode set to ${mode}`,
  });

  defineTool(server, {
    name: 'set_clip_launch_quantization',
    description:
      'Set the clip-specific launch quantization (overrides the Song.clip_trigger_quantization global). Enum: 0=Global (defer to global), 1=None, 2=8 Bars, 3=4 Bars, 4=2 Bars, 5=1 Bar, 6=1/2, 7=1/2T, 8=1/4, 9=1/4T, 10=1/8, 11=1/8T, 12=1/16, 13=1/16T, 14=1/32. Note: numbering differs from set_clip_trigger_quantization (the global) — clip-level adds 0=Global at the start, shifting the rest by 1.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      quantization: z.number().int().min(0).max(14),
    },
    handler: ({ track, slot, quantization }) =>
      lomSet(clipPath(track, slot), 'launch_quantization', quantization),
    successText: ({ quantization }) => `Clip launch quantization set to ${quantization}`,
  });

  defineTool(server, {
    name: 'set_clip_muted',
    description:
      "Toggle the Clip Activator (the on/off button on the clip). When on=true the clip is muted (won't produce sound when fired). Different from track mute — this is per-clip.",
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      on: z.boolean().describe('true = muted (clip activator off), false = active'),
    },
    handler: ({ track, slot, on }) => lomSet(clipPath(track, slot), 'muted', on ? 1 : 0),
    successText: ({ on }) => `Clip ${on ? 'muted' : 'unmuted'}`,
  });

  defineTool(server, {
    name: 'set_clip_pitch_fine',
    description:
      'Set the fine pitch shift on an audio clip ("Detune" knob in Live). Range -50..49 cents. Combined with set_clip_pitch (semitones) which is the "Transpose" knob. Audio clips only.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      cents: z.number().min(-50).max(49),
    },
    handler: ({ track, slot, cents }) => lomSet(clipPath(track, slot), 'pitch_fine', cents),
    successText: ({ cents }) => `Clip pitch fine set to ${cents} cents`,
  });
}

module.exports = { register };
