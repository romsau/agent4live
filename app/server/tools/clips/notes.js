'use strict';

// AUTO-AUTHORED — split out from app/server/tools/clips.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

'use strict';

const { z } = require('zod');
const { defineTool } = require('../define');
const {
  lomSet,
  lomCall,
  lomAddClip,
  lomGetClipNotes,
  lomReplaceClipNotes,
  lomApplyNoteModifications,
  lomGetAllNotes,
  lomGetSelectedNotes,
  lomGetNotesById,
  lomAddWarpMarker,
  lomRemoveNotesById,
  lomDuplicateNotesById,
} = require('../../lom');

// LOM path helpers — every clip operation either targets the clip slot
// (create / delete / duplicate) or the clip itself (everything else).
const slotPath = (track, slot) => `live_set tracks ${track} clip_slots ${slot}`;
const clipPath = (track, slot) => `${slotPath(track, slot)} clip`;

const colorHex = (color) => `0x${color.toString(16).toUpperCase().padStart(6, '0')}`;

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
 * Register the note editing tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Note editing — surgical operations on existing clips ──

  defineTool(server, {
    name: 'remove_notes_by_id',
    description:
      'Remove specific notes from a MIDI clip by their note_id. note_ids must come from a previous get_clip_notes / get_all_notes_extended / get_selected_notes_extended call. Notes whose IDs are not in the clip are silently ignored. Live 11+.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      note_ids: z.array(z.number().int()).min(1),
    },
    label: ({ track, slot, note_ids }) =>
      `remove_notes_by_id(${track},${slot},${note_ids.length}ids)`,
    handler: ({ track, slot, note_ids }) =>
      lomRemoveNotesById(track, slot, JSON.stringify(note_ids)),
    successText: ({ track, slot, note_ids }) =>
      `Removed ${note_ids.length} note(s) from clip at track ${track}, slot ${slot}`,
  });

  defineTool(server, {
    name: 'remove_notes_region',
    description:
      'Delete all notes that START in a given pitch + time region of a MIDI clip. Equivalent to "select region in MIDI editor and delete". from_time + time_span are in beats. Live 11+ method (replaces deprecated remove_notes).',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      from_pitch: z.number().int().min(0).max(127).describe('Lowest pitch to clear'),
      pitch_span: z.number().int().min(1).max(128).describe('Pitch span (1-128)'),
      from_time: z.number().min(0).describe('Start time in beats'),
      time_span: z.number().positive().describe('Duration in beats'),
    },
    label: ({ track, slot, from_pitch, pitch_span, from_time, time_span }) =>
      `remove_notes_region(${track},${slot},p${from_pitch}+${pitch_span},t${from_time}+${time_span})`,
    handler: ({ track, slot, from_pitch, pitch_span, from_time, time_span }) =>
      lomCall(
        clipPath(track, slot),
        'remove_notes_extended',
        from_pitch,
        pitch_span,
        from_time,
        time_span,
      ),
    successText: ({ track, slot, from_pitch, pitch_span, from_time, time_span }) =>
      `Notes removed from region pitch ${from_pitch}-${from_pitch + pitch_span - 1}, time ${from_time}-${from_time + time_span} on clip [${track},${slot}]`,
  });

  defineTool(server, {
    name: 'duplicate_notes_by_id',
    description:
      "Duplicate selected notes by note_id, optionally to a new time and/or transposed by N semitones. If destination_time is omitted, the new notes are inserted right after the last source note (matches Live's GUI behavior). Live 11+.",
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      note_ids: z.array(z.number().int()).min(1),
      destination_time: z
        .number()
        .min(0)
        .optional()
        .describe('New start time in beats (omit = right after last source note)'),
      transposition_amount: z
        .number()
        .int()
        .optional()
        .describe('Pitch shift in semitones (positive = up)'),
    },
    label: ({ track, slot, note_ids }) =>
      `duplicate_notes_by_id(${track},${slot},${note_ids.length}ids)`,
    handler: ({ track, slot, note_ids, destination_time, transposition_amount }) => {
      const params = { note_ids };
      if (destination_time !== undefined) params.destination_time = destination_time;
      if (transposition_amount !== undefined) params.transposition_amount = transposition_amount;
      return lomDuplicateNotesById(track, slot, JSON.stringify(params));
    },
    successText: ({ track, slot, note_ids }) =>
      `Duplicated ${note_ids.length} note(s) on clip [${track},${slot}]`,
  });

  defineTool(server, {
    name: 'duplicate_region',
    description:
      'Duplicate notes from a region (pitch + time) of a MIDI clip to a destination time, optionally transposed and/or filtered to a single pitch. region_start + region_length are in beats. pitch=-1 means duplicate all pitches; otherwise only that single pitch. Live 11+.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      region_start: z.number().min(0).describe('Source region start in beats'),
      region_length: z.number().positive().describe('Source region length in beats'),
      destination_time: z.number().min(0).describe('Destination time in beats'),
      pitch: z
        .number()
        .int()
        .min(-1)
        .max(127)
        .default(-1)
        .describe('Filter to single pitch (-1 = all pitches)'),
      transposition_amount: z
        .number()
        .int()
        .default(0)
        .describe('Pitch shift in semitones (0 = no transpose)'),
    },
    label: ({ track, slot, region_start, region_length, destination_time }) =>
      `duplicate_region(${track},${slot},${region_start}+${region_length}→${destination_time})`,
    handler: ({
      track,
      slot,
      region_start,
      region_length,
      destination_time,
      pitch,
      transposition_amount,
    }) =>
      lomCall(
        clipPath(track, slot),
        'duplicate_region',
        region_start,
        region_length,
        destination_time,
        pitch,
        transposition_amount,
      ),
    successText: ({ track, slot }) => `Region duplicated on clip [${track},${slot}]`,
  });

  defineTool(server, {
    name: 'add_clip',
    description:
      'Create a new MIDI clip on a track at a given clip slot, with optional notes. The slot must be empty — this tool does not overwrite. Track must be MIDI. Times are in beats (1 beat = 1 quarter note at any tempo). Pitch follows MIDI standard: 60=C4, 36=C2 (kick range). Use this for melodies, chord progressions, drum patterns, etc.',
    schema: {
      track_index: z.number().int().min(0).describe('Track index (0-based, must be a MIDI track)'),
      clip_slot_index: z.number().int().min(0).describe('Clip slot index (0-based, must be empty)'),
      length: z.number().positive().default(4).describe('Clip length in beats (default 4)'),
      notes: z
        .array(
          z.object({
            pitch: z.number().int().min(0).max(127).describe('MIDI pitch (0-127, 60=C4)'),
            time: z.number().min(0).describe('Start time in beats from clip start'),
            duration: z.number().positive().describe('Note duration in beats'),
            velocity: z.number().int().min(1).max(127).default(100).describe('Velocity (1-127)'),
          }),
        )
        .default([])
        .describe('Notes to add to the clip'),
    },
    label: ({ track_index, clip_slot_index }) => `add_clip(${track_index},${clip_slot_index})`,
    handler: ({ track_index, clip_slot_index, length, notes }) =>
      lomAddClip(track_index, clip_slot_index, length, JSON.stringify(notes)),
    successText: ({ track_index, clip_slot_index, notes }) =>
      `Clip created at track ${track_index}, slot ${clip_slot_index} with ${notes.length} note(s)`,
  });

  defineTool(server, {
    name: 'fire_clip_with_options',
    description:
      'Like fire_clip but with optional record_length (record for N beats then stop) and launch_quantization (override global quantize for this fire only). If both omitted, behavior is identical to fire_clip. record_length is in beats. launch_quantization uses the same enum as set_clip_launch_quantization (0=Global, 1=None, 2=8 Bars, ..., 14=1/32).',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      record_length: z
        .number()
        .positive()
        .optional()
        .describe('Beats to record (if slot is empty + track armed)'),
      launch_quantization: z
        .number()
        .int()
        .min(0)
        .max(14)
        .optional()
        .describe('Override global quantize for this fire only'),
    },
    label: ({ track, slot, record_length, launch_quantization }) =>
      `fire_clip_with_options(${track},${slot},rec=${record_length ?? '-'},q=${launch_quantization ?? '-'})`,
    handler: ({ track, slot, record_length, launch_quantization }) => {
      const path = slotPath(track, slot);
      if (record_length === undefined && launch_quantization === undefined) {
        return lomCall(path, 'fire');
      }
      if (launch_quantization === undefined) {
        return lomCall(path, 'fire', record_length);
      }
      if (record_length === undefined) {
        throw new Error(
          'launch_quantization requires record_length to also be provided (Live LOM constraint)',
        );
      }
      return lomCall(path, 'fire', record_length, launch_quantization);
    },
    successText: ({ track, slot }) => `Clip [${track},${slot}] fired with options`,
  });

  defineTool(server, {
    name: 'fire_clip',
    description:
      "Launch a specific clip on a given track + clip slot. Both indices 0-based. The slot must contain a clip — use add_clip first if it's empty.",
    schema: {
      track: z.number().describe('Track index (0-based)'),
      slot: z.number().describe('Clip slot index (0-based)'),
    },
    handler: ({ track, slot }) => lomCall(clipPath(track, slot), 'fire'),
    successText: ({ track, slot }) => `Clip [track ${track}, slot ${slot}] fired`,
  });

  defineTool(server, {
    name: 'stop_all_clips',
    description:
      'Stop all currently playing clips across the session. Does not stop the master transport or change tempo.',
    handler: () => lomCall('live_set', 'stop_all_clips'),
    successText: 'All clips stopped',
  });

  defineTool(server, {
    name: 'delete_clip',
    description:
      'Delete the clip at a given track + clip slot. Slot becomes empty afterwards. No-op silently if the slot is already empty.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
    },
    handler: ({ track, slot }) => lomCall(slotPath(track, slot), 'delete_clip'),
    successText: ({ track, slot }) => `Clip at track ${track}, slot ${slot} deleted`,
  });

  defineTool(server, {
    name: 'set_clip_name',
    description: 'Rename a clip. The slot must contain a clip.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
      name: z.string().describe('New clip name'),
    },
    handler: ({ track, slot, name }) => lomSet(clipPath(track, slot), 'name', name),
    successText: ({ track, slot, name }) =>
      `Clip at track ${track}, slot ${slot} renamed to "${name}"`,
  });

  defineTool(server, {
    name: 'set_clip_color',
    description:
      "Set a clip's color as a 24-bit RGB integer (0xRRGGBB). Live picks the closest swatch from its palette.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
      color: z
        .number()
        .int()
        .min(0)
        .max(0xffffff)
        .describe('RGB color as integer 0x000000-0xFFFFFF'),
    },
    handler: ({ track, slot, color }) => lomSet(clipPath(track, slot), 'color', color),
    successText: ({ track, slot, color }) =>
      `Clip at track ${track}, slot ${slot} color set to ${colorHex(color)}`,
  });

  defineTool(server, {
    name: 'quantize_clip',
    description:
      "Quantize all notes in a clip to a grid. The grid value is an integer following Live's quantize enum (try grid=7 for 1/4 note, 9 for 1/8, 11 for 1/16; experiment via lom_get on launch_quantization for similar enum). Amount 0.0 = no effect, 1.0 = full quantize. Takes Live's song.swing_amount into account. Permanent — use undo to revert (mind the undo caveats).",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
      grid: z
        .number()
        .int()
        .min(0)
        .describe('Quantize grid index (Live enum, e.g. 7=1/4, 9=1/8, 11=1/16)'),
      amount: z.number().min(0).max(1).describe('Quantize amount 0.0-1.0'),
    },
    handler: ({ track, slot, grid, amount }) =>
      lomCall(clipPath(track, slot), 'quantize', grid, amount),
    successText: ({ track, slot, grid, amount }) =>
      `Clip at track ${track}, slot ${slot} quantized (grid=${grid}, amount=${amount})`,
  });

  defineTool(server, {
    name: 'get_clip_notes',
    description:
      'Read all notes in a region of a MIDI clip. Returns a JSON array of note dictionaries: { note_id, pitch, start_time, duration, velocity, mute }. Defaults read the entire clip (all pitches, full clip length).',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
      from_pitch: z.number().int().min(0).max(127).default(0).describe('Lowest pitch (0-127)'),
      pitch_span: z.number().int().min(1).max(128).default(128).describe('Pitch span (1-128)'),
      from_time: z.number().min(0).default(0).describe('Start time in beats'),
      time_span: z
        .number()
        .positive()
        .default(10000)
        .describe('Duration in beats (default 10000 = effectively unlimited)'),
    },
    handler: ({ track, slot, from_pitch, pitch_span, from_time, time_span }) =>
      lomGetClipNotes(track, slot, from_pitch, pitch_span, from_time, time_span),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'apply_note_modifications',
    description:
      'Modify existing notes in a MIDI clip by note_id without removing or adding any. Each note in the input array is a partial update: must include note_id (from get_clip_notes / get_all_notes_extended), plus the properties to change (pitch, start_time, duration, velocity, mute, probability, velocity_deviation, release_velocity). Notes whose note_id is not in the clip are silently ignored.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
      notes: z
        .array(
          z.object({
            note_id: z.number().int().describe('Note identifier from get_clip_notes'),
            pitch: z.number().int().min(0).max(127).optional(),
            start_time: z.number().min(0).optional(),
            duration: z.number().positive().optional(),
            velocity: z.number().min(0).max(127).optional(),
            mute: z.number().int().min(0).max(1).optional(),
            probability: z.number().min(0).max(1).optional(),
            velocity_deviation: z.number().min(-127).max(127).optional(),
            release_velocity: z.number().min(0).max(127).optional(),
          }),
        )
        .describe('Partial note updates (note_id required, plus any fields to change)'),
    },
    label: ({ track, slot, notes }) =>
      `apply_note_modifications(${track},${slot},${notes.length}n)`,
    handler: ({ track, slot, notes }) =>
      lomApplyNoteModifications(track, slot, JSON.stringify({ notes })),
    successText: ({ track, slot, notes }) =>
      `Applied ${notes.length} note modification(s) to clip at track ${track}, slot ${slot}`,
  });

  defineTool(server, {
    name: 'get_all_notes_extended',
    description:
      'Read ALL notes in a MIDI clip (no bounds, regardless of loop or markers). Returns the same JSON shape as get_clip_notes. Convenience: equivalent to get_clip_notes with full pitch/time spans.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
    },
    handler: ({ track, slot }) => lomGetAllNotes(track, slot),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_selected_notes_extended',
    description:
      "Read the notes currently SELECTED in Live's MIDI editor for the given clip. Useful for interactive workflows where the user has selected a region in the GUI and wants the agent to operate on it. Returns the same JSON shape as get_clip_notes.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
    },
    handler: ({ track, slot }) => lomGetSelectedNotes(track, slot),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_notes_by_id',
    description:
      'Read specific notes from a MIDI clip by their note_id. The IDs must come from a previous get_clip_notes / get_all_notes_extended / get_selected_notes_extended call. Returns the same JSON shape (a subset of the source).',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
      ids: z.array(z.number().int()).min(1).describe('Note IDs to fetch'),
    },
    label: ({ track, slot, ids }) => `get_notes_by_id(${track},${slot},${ids.length}ids)`,
    handler: ({ track, slot, ids }) => lomGetNotesById(track, slot, JSON.stringify(ids)),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'add_warp_marker',
    description:
      "Add a warp marker to an audio clip (warped audio clips only). At least one of beat_time / sample_time must be provided. If only beat_time is given, Live calculates the matching sample_time without changing the clip's timing. If only sample_time is given, Live calculates the matching beat_time. Sample_time must lie in [0, sample_length] and between adjacent markers; resulting BPM must lie in [5, 999].",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
      beat_time: z.number().optional().describe('Beat time of the marker (optional)'),
      sample_time: z.number().min(0).optional().describe('Sample time of the marker (optional)'),
    },
    label: ({ track, slot, beat_time, sample_time }) =>
      `add_warp_marker(${track},${slot},bt=${beat_time},st=${sample_time})`,
    handler: ({ track, slot, beat_time, sample_time }) => {
      if (beat_time === undefined && sample_time === undefined) {
        throw new Error('add_warp_marker: at least one of beat_time / sample_time required');
      }
      return lomAddWarpMarker(track, slot, beat_time, sample_time);
    },
    successText: ({ track, slot }) => `Warp marker added to clip at track ${track}, slot ${slot}`,
  });

  defineTool(server, {
    name: 'replace_clip_notes',
    description:
      "Atomically replace ALL notes in a MIDI clip with a new set. Existing notes are removed first, then the new notes added (Dict-passing). Use this to patch an entire clip's content — for incremental edits, use add_clip with notes on a fresh slot. Notes use the same shape as add_clip.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      slot: z.number().int().min(0).describe('Clip slot index (0-based)'),
      notes: z
        .array(
          z.object({
            pitch: z.number().int().min(0).max(127).describe('MIDI pitch (0-127, 60=C4)'),
            time: z.number().min(0).describe('Start time in beats from clip start'),
            duration: z.number().positive().describe('Note duration in beats'),
            velocity: z.number().int().min(1).max(127).default(100).describe('Velocity (1-127)'),
            mute: z.number().int().min(0).max(1).optional().describe('1 = note muted (optional)'),
          }),
        )
        .describe('Notes to put in the clip (replaces everything)'),
    },
    label: ({ track, slot, notes }) => `replace_clip_notes(${track},${slot},${notes.length}n)`,
    handler: ({ track, slot, notes }) => lomReplaceClipNotes(track, slot, JSON.stringify(notes)),
    successText: ({ track, slot, notes }) =>
      `Clip at track ${track}, slot ${slot} replaced with ${notes.length} note(s)`,
  });
}

module.exports = { register };
