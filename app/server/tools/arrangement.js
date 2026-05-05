'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const {
  lomSet,
  lomCall,
  lomGetCuePoints,
  lomSetCuePointName,
  lomJumpToCue,
  lomDuplicateClipToArrangement,
  lomDeleteArrangementClip,
} = require('../lom');

/**
 * Register the Arrangement-view tools (song time, cue points, arrangement
 * clip duplication / deletion) on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  defineTool(server, {
    name: 'set_song_time',
    description:
      'Move the Arrangement playback position to a given beat. Affects the playhead in the Arrangement View. 1 beat = 1 quarter note. Note: setting this while the transport is stopped repositions the playhead; while playing it jumps the playhead live.',
    schema: {
      beats: z.number().min(0).describe('Position in beats from the start of the arrangement'),
    },
    handler: ({ beats }) => lomSet('live_set', 'current_song_time', beats),
    successText: ({ beats }) => `Song time set to beat ${beats}`,
  });

  defineTool(server, {
    name: 'set_loop',
    description:
      'Toggle the Arrangement loop and optionally set its region (in beats). When on=true and start/length are omitted, the existing loop region is kept. Loop region is start..(start+length).',
    schema: {
      on: z.boolean().describe('true = enable arrangement loop, false = disable'),
      start: z.number().min(0).optional().describe('Loop start in beats (optional)'),
      length: z.number().positive().optional().describe('Loop length in beats (optional)'),
    },
    label: ({ on, start, length }) => `set_loop(${on},start=${start},len=${length})`,
    handler: async ({ on, start, length }) => {
      await lomSet('live_set', 'loop', on ? 1 : 0);
      if (on && start !== undefined) await lomSet('live_set', 'loop_start', start);
      if (on && length !== undefined) await lomSet('live_set', 'loop_length', length);
    },
    successText: ({ on, start, length }) => {
      const range =
        on && (start !== undefined || length !== undefined)
          ? ` [${start ?? '?'} for ${length ?? '?'}]`
          : '';
      return `Arrangement loop ${on ? 'on' : 'off'}${range}`;
    },
  });

  defineTool(server, {
    name: 'set_punch',
    description:
      'Toggle Punch In and/or Punch Out independently. Punch In/Out gates which part of the arrangement loop region accepts new recording. Pass only the flag(s) you want to change — others are left untouched.',
    schema: {
      punch_in: z.boolean().optional().describe('Enable/disable Punch In (optional)'),
      punch_out: z.boolean().optional().describe('Enable/disable Punch Out (optional)'),
    },
    label: ({ punch_in, punch_out }) => `set_punch(in=${punch_in},out=${punch_out})`,
    handler: async ({ punch_in, punch_out }) => {
      if (punch_in === undefined && punch_out === undefined) {
        throw new Error('set_punch: at least one of punch_in / punch_out required');
      }
      if (punch_in !== undefined) await lomSet('live_set', 'punch_in', punch_in ? 1 : 0);
      if (punch_out !== undefined) await lomSet('live_set', 'punch_out', punch_out ? 1 : 0);
    },
    successText: ({ punch_in, punch_out }) =>
      `Punch in=${punch_in ?? 'unchanged'} out=${punch_out ?? 'unchanged'}`,
  });

  defineTool(server, {
    name: 'set_or_delete_cue',
    description:
      'Toggle a cue point at the current Arrangement playback position. If a cue exists there it is removed; otherwise a new one is created. Combine with set_song_time first to place a cue at a specific beat.',
    handler: () => lomCall('live_set', 'set_or_delete_cue'),
    successText: 'Cue point toggled at current position',
  });

  defineTool(server, {
    name: 'jump_to_next_cue',
    description:
      'Move the Arrangement playhead to the next cue point (to the right). No-op if there is no next cue. Quantized to the launch quantization while playing.',
    handler: () => lomCall('live_set', 'jump_to_next_cue'),
    successText: 'Jumped to next cue',
  });

  defineTool(server, {
    name: 'jump_to_prev_cue',
    description:
      'Move the Arrangement playhead to the previous cue point (to the left). No-op if there is no previous cue.',
    handler: () => lomCall('live_set', 'jump_to_prev_cue'),
    successText: 'Jumped to previous cue',
  });

  defineTool(server, {
    name: 'set_cue_point_name',
    description:
      "Rename a cue point by its index in the song's cue_points list. Use get_cue_points to find the index (cue_points are sorted by time).",
    schema: {
      cue_index: z.number().int().min(0),
      name: z.string(),
    },
    handler: ({ cue_index, name }) => lomSetCuePointName(cue_index, name),
    successText: ({ cue_index, name }) => `Cue point ${cue_index} renamed to "${name}"`,
  });

  // NB: set_cue_point_time pas exposé. CuePoint.time est documenté float sans
  // read-only mais Live 12 ignore silencieusement le SET. Pour déplacer un
  // cue, il faut delete (set_or_delete_cue à sa position) puis recreate à la
  // nouvelle position. Documenté LOM_NOTES.md.

  defineTool(server, {
    name: 'jump_to_cue',
    description:
      "Jump the playhead to a specific cue point by its index. Quantized if the song is playing (matches Live's default cue jump behavior). Different from jump_to_next/prev_cue which navigate by direction.",
    schema: { cue_index: z.number().int().min(0) },
    handler: ({ cue_index }) => lomJumpToCue(cue_index),
    successText: ({ cue_index }) => `Jumped to cue point ${cue_index}`,
  });

  defineTool(server, {
    name: 'get_cue_points',
    description:
      'List all cue points in the Arrangement: JSON array of { name, time } sorted by Live in arrangement order. Use this to discover navigation targets before set_song_time / jump_to_*.',
    handler: () => lomGetCuePoints(),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_arrangement_overdub',
    description:
      'Toggle the MIDI Arrangement Overdub button. When on, recording an armed MIDI track in arrangement layers new notes on top of existing clip content instead of replacing it.',
    schema: { on: z.boolean().describe('true = enable arrangement overdub, false = disable') },
    handler: ({ on }) => lomSet('live_set', 'arrangement_overdub', on ? 1 : 0),
    successText: ({ on }) => `Arrangement overdub ${on ? 'on' : 'off'}`,
  });

  // NB: set_song_back_to_arranger pas exposé. Live ignore silencieusement le
  // SET sur Song.back_to_arranger (état dérivé du playback). Voir LOM_NOTES.
  // Pour clear l'override (= revenir à l'arrangement), utiliser back_to_arranger.

  defineTool(server, {
    name: 'back_to_arranger',
    description:
      'Reset Live to play the Arrangement timeline (clears the "Back to Arrangement" highlighted state). Use after launching session clips when you want to return to playing the linear arrangement.',
    handler: () => lomSet('live_set', 'back_to_arranger', 0),
    successText: 'Returned to arrangement playback',
  });

  defineTool(server, {
    name: 'duplicate_clip_to_arrangement',
    description:
      'Copy a session-view clip into the Arrangement at a given destination time (in beats). The session clip remains in its slot; a copy is placed on the same track in the arrangement timeline. Track must be the same track as the source slot.',
    schema: {
      track: z
        .number()
        .int()
        .min(0)
        .describe('Track index (0-based) — also the destination track in arrangement'),
      slot: z.number().int().min(0).describe('Source clip slot (0-based, must contain a clip)'),
      destination_time: z
        .number()
        .min(0)
        .describe('Destination position in the arrangement, in beats'),
    },
    handler: ({ track, slot, destination_time }) =>
      lomDuplicateClipToArrangement(track, slot, destination_time),
    successText: ({ track, slot, destination_time }) =>
      `Clip [track ${track}, slot ${slot}] duplicated to arrangement at beat ${destination_time}`,
  });

  defineTool(server, {
    name: 'delete_arrangement_clip',
    description:
      'Delete a clip from the Arrangement timeline of a track. Index targets the position in track.arrangement_clips (0 = leftmost arrangement clip on that track). Session-view clips are not affected — use delete_clip for those.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      arrangement_clip_idx: z
        .number()
        .int()
        .min(0)
        .describe('Arrangement clip index on this track (0 = first/leftmost)'),
    },
    handler: ({ track, arrangement_clip_idx }) =>
      lomDeleteArrangementClip(track, arrangement_clip_idx),
    successText: ({ track, arrangement_clip_idx }) =>
      `Arrangement clip ${arrangement_clip_idx} on track ${track} deleted`,
  });
}

module.exports = { register };
