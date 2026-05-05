'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet, lomCall, lomSessionState } = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.
const trackPath = (track) => `live_set tracks ${track}`;
const mixerPath = (track) => `${trackPath(track)} mixer_device`;

const colorHex = (color) => `0x${color.toString(16).toUpperCase().padStart(6, '0')}`;

/**
 * Set a track's name when one was supplied at create-time. Resolves index=-1
 * to the freshly-appended track (which lives at `track_count - 1` after the
 * underlying create call).
 *
 * @param {number} index - Resolved track index, or -1 to mean "the last one".
 * @param {string|undefined} name - Optional name; no-op when falsy.
 * @returns {Promise<void>}
 */
async function appendNewTrackName(index, name) {
  if (!name) return;
  const stateJson = await lomSessionState();
  let state;
  try {
    state = JSON.parse(stateJson);
  } catch (err) {
    throw new Error(`Failed to parse session state: ${err.message}`);
  }
  if (index === -1 && (typeof state.track_count !== 'number' || state.track_count < 1)) {
    throw new Error(`Unexpected track_count in session state: ${state.track_count}`);
  }
  const trackIndex = index === -1 ? state.track_count - 1 : index;
  await lomSet(trackPath(trackIndex), 'name', name);
}

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the mixer + lifecycle tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Mixer + lifecycle (volume, panning, sends, create/delete/mute/solo/arm/name/color) ──

  defineTool(server, {
    name: 'set_track_volume',
    description:
      "Set a track's volume. Value is 0.0 to 1.0 in LOM units (≈0.85 = 0 dB, 1.0 = +6 dB, 0.0 = silence). Volume lives on the track's mixer_device — this tool handles the path. Use get_session_state to find the track index.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      value: z.number().min(0).max(1).describe('Volume value 0.0 to 1.0 (≈0.85 = 0 dB)'),
    },
    handler: ({ track, value }) => lomSet(`${mixerPath(track)} volume`, 'value', value),
    successText: ({ track, value }) => `Volume of track ${track} set to ${value}`,
  });

  defineTool(server, {
    name: 'set_track_panning',
    description:
      "Set a track's pan position. Value is -1.0 (full left) to 1.0 (full right), 0.0 = center. Panning lives on the track's mixer_device — this tool handles the path.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      value: z.number().min(-1).max(1).describe('Pan -1.0 (left) to 1.0 (right), 0.0 = center'),
    },
    handler: ({ track, value }) => lomSet(`${mixerPath(track)} panning`, 'value', value),
    successText: ({ track, value }) => `Panning of track ${track} set to ${value}`,
  });

  defineTool(server, {
    name: 'set_track_send',
    description:
      "Set the level of a track's send to a return track. Value is 0.0 (no send) to 1.0 (full). The send_index matches the order of return tracks (0 = first return, 1 = second, etc.). Returns silently no-op if send_index is out of range — verify by checking the send level after.",
    schema: {
      track: z.number().int().min(0).describe('Source track index (0-based)'),
      send_index: z.number().int().min(0).describe('Send index, matches return track order'),
      value: z.number().min(0).max(1).describe('Send level 0.0 (no send) to 1.0 (full)'),
    },
    handler: ({ track, send_index, value }) =>
      lomSet(`${mixerPath(track)} sends ${send_index}`, 'value', value),
    successText: ({ track, send_index, value }) =>
      `Send ${send_index} of track ${track} set to ${value}`,
  });

  defineTool(server, {
    name: 'create_midi_track',
    description:
      "Create a new MIDI track in the session. By default appends at the end (index=-1). Optionally name the track on creation. Does not load any instrument — the track is empty until the user adds one. Use get_session_state afterwards to find the new track's index.",
    schema: {
      index: z.number().optional().describe('Insert position (-1 = end)'),
      name: z.string().optional().describe('Track name (optional)'),
    },
    label: ({ name }) => `create_midi_track${name ? `(${name})` : ''}`,
    handler: async ({ index = -1, name }) => {
      await lomCall('live_set', 'create_midi_track', index);
      await appendNewTrackName(index, name);
    },
    successText: ({ name }) => `MIDI track created${name ? ` "${name}"` : ''}`,
  });

  defineTool(server, {
    name: 'create_audio_track',
    description:
      "Create a new audio track in the session. By default appends at the end (index=-1). Optionally name the track on creation. Audio tracks accept audio clips (samples) — use create_midi_track for MIDI/instrument tracks. Use get_session_state afterwards to find the new track's index.",
    schema: {
      index: z.number().optional().describe('Insert position (-1 = end)'),
      name: z.string().optional().describe('Track name (optional)'),
    },
    label: ({ name }) => `create_audio_track${name ? `(${name})` : ''}`,
    handler: async ({ index = -1, name }) => {
      await lomCall('live_set', 'create_audio_track', index);
      await appendNewTrackName(index, name);
    },
    successText: ({ name }) => `Audio track created${name ? ` "${name}"` : ''}`,
  });

  defineTool(server, {
    name: 'create_return_track',
    description:
      'Add a new return track at the end of the return tracks list. Return tracks receive sends from regular tracks (use set_track_send). The LOM does not allow specifying position or name on creation — rename via lom_set on the new return track if needed (path: "live_set return_tracks N").',
    handler: () => lomCall('live_set', 'create_return_track'),
    successText: 'Return track created',
  });

  defineTool(server, {
    name: 'mute_track',
    description:
      'Mute or unmute a track. Targets regular tracks (live_set tracks N), not return or master.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      on: z.boolean().describe('true = muted, false = audible'),
    },
    handler: ({ track, on }) => lomSet(trackPath(track), 'mute', on ? 1 : 0),
    successText: ({ track, on }) => `Track ${track} ${on ? 'muted' : 'unmuted'}`,
  });

  defineTool(server, {
    name: 'solo_track',
    description:
      "Solo or unsolo a track. Live's exclusive_solo setting determines whether soloing this track unsolos others (default: yes).",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      on: z.boolean().describe('true = soloed, false = un-soloed'),
    },
    handler: ({ track, on }) => lomSet(trackPath(track), 'solo', on ? 1 : 0),
    successText: ({ track, on }) => `Track ${track} ${on ? 'soloed' : 'un-soloed'}`,
  });

  defineTool(server, {
    name: 'arm_track',
    description:
      'Arm or disarm a track for recording. Only audio and MIDI tracks can be armed (Track.can_be_armed). Group tracks, return tracks, and master cannot — silently no-op there. Combine with set_record_mode + start_playing for live recording.',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      on: z.boolean().describe('true = armed for recording, false = disarmed'),
    },
    handler: ({ track, on }) => lomSet(trackPath(track), 'arm', on ? 1 : 0),
    successText: ({ track, on }) => `Track ${track} ${on ? 'armed' : 'disarmed'}`,
  });

  defineTool(server, {
    name: 'set_track_name',
    description:
      'Rename a regular track. For return tracks, use lom_set on path "live_set return_tracks N" with property "name".',
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      name: z.string().describe('New track name'),
    },
    handler: ({ track, name }) => lomSet(trackPath(track), 'name', name),
    successText: ({ track, name }) => `Track ${track} renamed to "${name}"`,
  });

  defineTool(server, {
    name: 'set_track_color',
    description:
      "Set a track's color as a 24-bit RGB integer (0xRRGGBB). Common values: red=0xFF0000, green=0x00FF00, blue=0x0000FF, orange=0xFF8000, purple=0x9000FF. Live picks the closest swatch from its palette.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      color: z
        .number()
        .int()
        .min(0)
        .max(0xffffff)
        .describe('RGB color as integer 0x000000-0xFFFFFF'),
    },
    handler: ({ track, color }) => lomSet(trackPath(track), 'color', color),
    successText: ({ track, color }) => `Track ${track} color set to ${colorHex(color)}`,
  });

  defineTool(server, {
    name: 'delete_track',
    description:
      'Delete a track by index. Cannot be undone via this tool — use the undo tool to restore.',
    schema: { index: z.number().int().min(0).describe('Track index to delete (0-based)') },
    handler: ({ index }) => lomCall('live_set', 'delete_track', index),
    successText: ({ index }) => `Track ${index} deleted`,
  });

  defineTool(server, {
    name: 'duplicate_track',
    description:
      'Duplicate a track. The new track is inserted right after the source. Copies all clips, devices, sends, and routing.',
    schema: { index: z.number().int().min(0).describe('Source track index (0-based)') },
    handler: ({ index }) => lomCall('live_set', 'duplicate_track', index),
    successText: ({ index }) => `Track ${index} duplicated`,
  });
}

module.exports = { register };
