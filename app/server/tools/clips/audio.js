'use strict';

// AUTO-AUTHORED — split out from app/server/tools/clips.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

'use strict';

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet, lomCall, lomGetClipAudioInfo, lomGetWarpMarkers } = require('../../lom');

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
 * Register the audio clip operations tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Audio clip operations ──

  defineTool(server, {
    name: 'get_clip_audio_info',
    description:
      'Read all audio-clip-relevant properties in one call. Returns JSON: { is_audio_clip, file_path, sample_length, sample_rate, warping, warp_mode, gain, pitch_coarse, pitch_fine, start_marker, end_marker, ram_mode }. For MIDI clips returns { is_audio_clip: false } only — none of the other props apply.',
    schema: {
      track: z.number().int().min(0).describe('Track index'),
      slot: z.number().int().min(0).describe('Clip slot index'),
    },
    handler: ({ track, slot }) => lomGetClipAudioInfo(track, slot),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_clip_warp',
    description:
      'Toggle the Warp switch on an audio clip. When on=false the clip plays at its original sample rate (no time-stretching to match tempo). No-op on MIDI clips.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      on: z.boolean().describe('true = warp engaged'),
    },
    handler: ({ track, slot, on }) => lomSet(clipPath(track, slot), 'warping', on ? 1 : 0),
    successText: ({ on }) => `Clip warp ${on ? 'on' : 'off'}`,
  });

  defineTool(server, {
    name: 'set_clip_warp_mode',
    description:
      'Set the Warp Mode of an audio clip. mode is an integer: 0=Beats, 1=Tones, 2=Texture, 3=Re-Pitch, 4=Complex, 5=Complex Pro. Beats is best for percussive/rhythmic material; Tones for melodic/monophonic; Complex/Complex Pro for full mixes; Re-Pitch disables warping algorithms (sample plays at adjusted speed). No-op on MIDI clips.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      mode: z
        .number()
        .int()
        .min(0)
        .max(5)
        .describe('Warp mode 0-5 (Beats/Tones/Texture/Re-Pitch/Complex/Complex Pro)'),
    },
    handler: ({ track, slot, mode }) => lomSet(clipPath(track, slot), 'warp_mode', mode),
    successText: ({ mode }) => `Clip warp mode set to ${mode}`,
  });

  defineTool(server, {
    name: 'set_clip_gain',
    description:
      "Set the clip gain (audio clips only). Range 0.0 to 1.0 in LOM units (Live's clip gain knob). Use get_clip_audio_info to read the current value. No-op on MIDI clips.",
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      value: z.number().min(0).max(1).describe('Gain 0.0-1.0'),
    },
    handler: ({ track, slot, value }) => lomSet(clipPath(track, slot), 'gain', value),
    successText: ({ value }) => `Clip gain set to ${value}`,
  });

  defineTool(server, {
    name: 'set_clip_pitch',
    description:
      'Pitch-shift an audio clip. coarse is in semitones (-48..48, "Transpose" knob). fine is extra cents (-50..49, "Detune" knob). Pass only the fields you want to change. Audio clips only — no-op on MIDI.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      coarse: z.number().int().min(-48).max(48).optional().describe('Semitones (-48..48)'),
      fine: z.number().min(-50).max(49).optional().describe('Cents (-50..49)'),
    },
    label: ({ track, slot, coarse, fine }) =>
      `set_clip_pitch(${track},${slot},c=${coarse},f=${fine})`,
    handler: async ({ track, slot, coarse, fine }) => {
      if (coarse === undefined && fine === undefined) {
        throw new Error('set_clip_pitch: at least one of coarse / fine required');
      }
      const path = clipPath(track, slot);
      if (coarse !== undefined) await lomSet(path, 'pitch_coarse', coarse);
      if (fine !== undefined) await lomSet(path, 'pitch_fine', fine);
    },
    successText: 'Clip pitch updated',
  });

  defineTool(server, {
    name: 'set_clip_markers',
    description:
      'Set the start_marker / end_marker of an audio clip (in beats). These define the playback range, independent of the loop region. end_marker cannot be set before start_marker. Pass only the fields you want to change.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      start: z.number().min(0).optional().describe('Start marker in beats'),
      end: z.number().min(0).optional().describe('End marker in beats'),
    },
    label: ({ track, slot, start, end }) =>
      `set_clip_markers(${track},${slot},s=${start},e=${end})`,
    handler: async ({ track, slot, start, end }) => {
      if (start === undefined && end === undefined) {
        throw new Error('set_clip_markers: at least one of start / end required');
      }
      const path = clipPath(track, slot);
      // end_marker cannot be set before start, so apply start first if both
      if (start !== undefined) await lomSet(path, 'start_marker', start);
      if (end !== undefined) await lomSet(path, 'end_marker', end);
    },
    successText: 'Clip markers updated',
  });

  defineTool(server, {
    name: 'set_clip_ram_mode',
    description:
      'Toggle the RAM switch on an audio clip. When on, the entire sample is loaded into RAM (lower disk activity, more memory). For long samples used heavily in performance, RAM mode may help avoid disk hiccups.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ track, slot, on }) => lomSet(clipPath(track, slot), 'ram_mode', on ? 1 : 0),
    successText: ({ on }) => `RAM mode ${on ? 'on' : 'off'}`,
  });

  defineTool(server, {
    name: 'crop_clip',
    description:
      'Crop a clip to its current playable region. If looping is enabled, the region outside the loop is removed; otherwise the region outside start_marker / end_marker. Permanent destructive — undo restores. Works on both audio and MIDI clips.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
    },
    handler: ({ track, slot }) => lomCall(clipPath(track, slot), 'crop'),
    successText: 'Clip cropped',
  });

  defineTool(server, {
    name: 'remove_warp_marker',
    description:
      'Remove the warp marker at a given beat_time on an audio clip. Audio clips only. Use get_warp_markers first to find existing markers.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      beat_time: z.number().describe('Beat time of the marker to remove (must match exactly)'),
    },
    handler: ({ track, slot, beat_time }) =>
      lomCall(clipPath(track, slot), 'remove_warp_marker', beat_time),
    successText: ({ beat_time }) => `Warp marker at beat ${beat_time} removed`,
  });

  defineTool(server, {
    name: 'get_warp_markers',
    description:
      'List all warp markers of an audio clip. Returns JSON array of [{sample_time, beat_time}, ...] — sample_time in seconds in the audio file, beat_time in clip beats. Audio clips only.',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
    },
    handler: ({ track, slot }) => lomGetWarpMarkers(track, slot),
    successText: (_args, json) => String(json),
  });
}

module.exports = { register };
