'use strict';

// AUTO-AUTHORED — split out from app/server/tools/clips.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

'use strict';

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomCall, lomAddNotesToClip, lomDuplicateClipToSlot } = require('../../lom');

// LOM path helpers — every clip operation either targets the clip slot
// (create / delete / duplicate) or the clip itself (everything else).
const slotPath = (track, slot) => `live_set tracks ${track} clip_slots ${slot}`;
const trackPath = (track) => `live_set tracks ${track}`;

// Reusable Zod sub-schema for note arrays passed to add_notes_to_clip /
// replace_clip_notes / add_clip — each tool tweaks slightly so we keep the
// constructors local rather than freezing one shape.
const fullNoteShape = {
  pitch: z.number().int().min(0).max(127),
  start_time: z.number().min(0).describe('Note start time in beats from clip start'),
  duration: z.number().positive(),
  velocity: z.number().min(0).max(127).default(100),
  mute: z.number().int().min(0).max(1).optional(),
  probability: z.number().min(0).max(1).optional(),
  velocity_deviation: z.number().min(-127).max(127).optional(),
  release_velocity: z.number().min(0).max(127).optional(),
};

/**
 * Register the clip tools: creation (Arrangement + Session, MIDI + audio),
 * note manipulation, audio inspection, warp markers, envelopes.
 *
 * @param {object} server
 */

/**
 * Register the clip creation tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Clip creation (Arrangement + Session, MIDI + audio) ──

  defineTool(server, {
    name: 'create_arrangement_midi_clip',
    description:
      'Create an empty MIDI clip in the Arrangement view at a specific time. Throws on non-MIDI tracks, frozen tracks, or if track is being recorded into. Returns nothing — use raw lom_get on the new arrangement_clips entry to verify, or lom_call get_all_notes_extended to inspect.',
    schema: {
      track: z.number().int().min(0).describe('Track index (must be MIDI)'),
      start_time: z.number().min(0).describe('Position in beats from arrangement start'),
      length: z.number().positive().describe('Clip length in beats'),
    },
    handler: ({ track, start_time, length }) =>
      lomCall(trackPath(track), 'create_midi_clip', start_time, length),
    successText: ({ track, start_time, length }) =>
      `MIDI clip created on track ${track} at beat ${start_time} (length ${length})`,
  });

  defineTool(server, {
    name: 'create_arrangement_audio_clip',
    description:
      'Create an audio clip in the Arrangement view by referencing an audio file on disk (absolute path required, e.g. /Users/.../sample.wav). Throws on non-audio tracks, frozen tracks, or if track is being recorded into.',
    schema: {
      track: z.number().int().min(0).describe('Track index (must be audio)'),
      file_path: z
        .string()
        .describe('Absolute path to a valid audio file (.wav, .aif, .mp3, .ogg, .flac)'),
      position: z.number().min(0).describe('Position in beats from arrangement start'),
    },
    handler: ({ track, file_path, position }) =>
      lomCall(trackPath(track), 'create_audio_clip', file_path, position),
    successText: ({ track, position }) =>
      `Audio clip created on track ${track} at beat ${position}`,
  });

  defineTool(server, {
    name: 'create_session_clip',
    description:
      'Create an empty MIDI clip in a Session view slot. Use this for empty clips (will create a length-only clip with no notes); use add_clip if you also want to add notes in one call. The slot must be empty and on a MIDI track.',
    schema: {
      track: z.number().int().min(0).describe('Track index (must be MIDI)'),
      slot: z.number().int().min(0).describe('Clip slot index (must be empty)'),
      length: z.number().positive().describe('Clip length in beats'),
    },
    handler: ({ track, slot, length }) => lomCall(slotPath(track, slot), 'create_clip', length),
    successText: ({ track, slot, length }) =>
      `MIDI clip created at track ${track}, slot ${slot} (length ${length})`,
  });

  defineTool(server, {
    name: 'create_session_audio_clip',
    description:
      'Create an audio clip in a Session view slot by referencing an audio file on disk. Throws on non-audio tracks or frozen tracks.',
    schema: {
      track: z.number().int().min(0).describe('Track index (must be audio)'),
      slot: z.number().int().min(0),
      file_path: z.string().describe('Absolute path to a valid audio file'),
    },
    handler: ({ track, slot, file_path }) =>
      lomCall(slotPath(track, slot), 'create_audio_clip', file_path),
    successText: ({ track, slot }) => `Audio clip created at track ${track}, slot ${slot}`,
  });

  defineTool(server, {
    name: 'add_notes_to_clip',
    description:
      'Add notes to an existing MIDI clip without replacing existing ones (vs replace_clip_notes which wipes everything first). Returns the list of note IDs assigned to the added notes (Live 11+). Use this for layered editing, growing clips, etc.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      notes: z.array(z.object(fullNoteShape)).min(1),
    },
    label: ({ track, slot, notes }) => `add_notes_to_clip(${track},${slot},${notes.length}n)`,
    handler: ({ track, slot, notes }) => lomAddNotesToClip(track, slot, JSON.stringify(notes)),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'duplicate_clip_to_slot',
    description:
      'Duplicate a session clip to another clip slot. Source slot must contain a clip ; destination slot can be empty or have a clip (it will be replaced). Both slots must be on tracks of compatible types (audio→audio, MIDI→MIDI).',
    schema: {
      source_track: z.number().int().min(0),
      source_slot: z.number().int().min(0),
      destination_track: z.number().int().min(0),
      destination_slot: z.number().int().min(0),
    },
    label: ({ source_track, source_slot, destination_track, destination_slot }) =>
      `duplicate_clip_to_slot(${source_track},${source_slot}→${destination_track},${destination_slot})`,
    handler: ({ source_track, source_slot, destination_track, destination_slot }) =>
      lomDuplicateClipToSlot(source_track, source_slot, destination_track, destination_slot),
    successText: ({ source_track, source_slot, destination_track, destination_slot }) =>
      `Clip duplicated from [${source_track},${source_slot}] to [${destination_track},${destination_slot}]`,
  });
}

module.exports = { register };
