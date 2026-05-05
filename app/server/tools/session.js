'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const {
  lomSet,
  lomCall,
  lomSessionState,
  lomGetScale,
  lomGetSelection,
  lomSelectTrack,
  lomSelectScene,
  lomGetGrooves,
  lomSetClipGroove,
} = require('../lom');

/**
 * Register the high-level session tools (snapshot of state, scale, selection,
 * grooves) on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  defineTool(server, {
    name: 'get_session_state',
    description:
      'Get a snapshot of the Live session: tempo, is_playing, list of tracks (index, name, is_midi_track, muted), list of scenes (index, name). Use this to understand the current session before making changes, or to find a track index after creating one.',
    handler: () => lomSessionState(),
    successText: (_args, json) => json,
  });

  defineTool(server, {
    name: 'set_tempo',
    description:
      "Set Ableton Live's master tempo in BPM. Affects the entire session (all tracks). Range 20-999.",
    schema: { bpm: z.number().describe('Tempo in BPM (20-999)') },
    handler: ({ bpm }) => lomSet('live_set', 'tempo', bpm),
    successText: ({ bpm }) => `Tempo set to ${bpm} BPM`,
  });

  defineTool(server, {
    name: 'set_signature',
    description:
      'Set the global time signature. denominator must be a power of 2 (2, 4, 8, 16…). E.g. 4/4, 3/4, 6/8, 7/8. Affects how Live counts beats and bars across the whole set.',
    schema: {
      numerator: z.number().int().min(1).max(99).describe('Beats per bar'),
      denominator: z.number().int().min(1).describe('Note value (must be power of 2)'),
    },
    label: ({ numerator, denominator }) => `set_signature(${numerator}/${denominator})`,
    handler: async ({ numerator, denominator }) => {
      await lomSet('live_set', 'signature_numerator', numerator);
      await lomSet('live_set', 'signature_denominator', denominator);
    },
    successText: ({ numerator, denominator }) =>
      `Time signature set to ${numerator}/${denominator}`,
  });

  defineTool(server, {
    name: 'set_clip_trigger_quantization',
    description:
      'Set the global clip launch quantization (the value shown in the transport bar). Affects when fired clips actually start playing. Enum: 0=None, 1=8 Bars, 2=4 Bars, 3=2 Bars, 4=1 Bar, 5=1/2, 6=1/2T, 7=1/4, 8=1/4T, 9=1/8, 10=1/8T, 11=1/16, 12=1/16T, 13=1/32.',
    schema: { value: z.number().int().min(0).max(13).describe('Quantization enum (0-13)') },
    handler: ({ value }) => lomSet('live_set', 'clip_trigger_quantization', value),
    successText: ({ value }) => `Clip trigger quantization set to ${value}`,
  });

  defineTool(server, {
    name: 'set_midi_recording_quantization',
    description:
      "Set the global MIDI Record Quantization. Same enum as set_clip_trigger_quantization (0=None, 1=8 Bars, ..., 13=1/32). Notes recorded in MIDI clips snap to this grid as they're recorded. Live may snap your value to the nearest one it considers valid given the current state — always read back via lom_get to confirm.",
    schema: { value: z.number().int().min(0).max(13).describe('Quantization enum (0-13)') },
    handler: ({ value }) => lomSet('live_set', 'midi_recording_quantization', value),
    successText: ({ value }) => `MIDI recording quantization set to ${value}`,
  });

  // NB: exclusive_arm and exclusive_solo are documented as get/set bool but
  // in practice Live treats them as a Pref-mirror — LOM SET silently
  // ignored. Not exposed; see LOM_NOTES.md.

  defineTool(server, {
    name: 're_enable_automation',
    description:
      'Trigger the "Re-Enable Automation" action — re-activates automation on parameters that were manually overridden. Same as clicking the Re-Enable Automation button in the transport bar (highlights when at least one param is overridden).',
    handler: () => lomCall('live_set', 're_enable_automation'),
    successText: 'Automation re-enabled',
  });

  // ── Scale mode (Live 12+) ──

  defineTool(server, {
    name: 'get_scale',
    description:
      'Read all scale-related state from Live (Live 12+). Returns JSON: { scale_name (e.g. "Major", "Minor", "Dorian"), root_note (0-11, 0=C, 11=B), scale_mode (bool — is Scale Mode globally on?), scale_intervals (list of int, semitones from root for each scale degree) }. Useful for harmonic generation: combine root_note + scale_intervals to know which MIDI pitches belong to the current scale.',
    handler: () => lomGetScale(),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_scale_mode',
    description:
      "Toggle the global Scale Mode. When on, key tracks belonging to the current scale are highlighted in Live's MIDI Note Editor, and pitch-based parameters in MIDI Tools and Devices use scale degrees rather than semitones. Live 12+.",
    schema: { on: z.boolean() },
    handler: ({ on }) => lomSet('live_set', 'scale_mode', on ? 1 : 0),
    successText: ({ on }) => `Scale mode ${on ? 'on' : 'off'}`,
  });

  defineTool(server, {
    name: 'set_scale_name',
    description:
      'Set the current scale by name (e.g. "Major", "Minor", "Dorian", "Mixolydian", "Phrygian", "Lydian", "Locrian", "Major Pentatonic", "Minor Pentatonic", "Blues", "Whole Tone"…). Live 12+. The name must match one of Live\'s built-in scale presets exactly. Read back via get_scale to confirm — Live may snap to the closest match if the name is unknown.',
    schema: { name: z.string().describe('Scale name (e.g. "Major", "Minor")') },
    handler: ({ name }) => lomSet('live_set', 'scale_name', name),
    successText: ({ name }) => `Scale name set to "${name}"`,
  });

  defineTool(server, {
    name: 'set_root_note',
    description:
      'Set the root note of the current scale (Live 12+). value is 0-11, where 0=C, 1=C#, 2=D, …, 11=B. Combined with scale_name to define the active scale.',
    schema: { value: z.number().int().min(0).max(11).describe('Root note 0-11 (0=C, 11=B)') },
    handler: ({ value }) => lomSet('live_set', 'root_note', value),
    successText: ({ value }) => `Root note set to ${value}`,
  });

  // ── Groove pool (Live 11+) ──

  defineTool(server, {
    name: 'get_grooves',
    description:
      "List all grooves in the set's groove pool. Returns JSON [{index, name, base, quantization_amount, random_amount, timing_amount, velocity_amount}, ...]. base enum: 0=1/4, 1=1/8, 2=1/8T, 3=1/16, 4=1/16T, 5=1/32. Each amount is 0.0-1.0.",
    handler: () => lomGetGrooves(),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_groove',
    description:
      "Update properties of a groove in the pool. Pass only the fields you want to change. base is the grid enum (0-5: 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32). amounts are 0-100 (percent — Live's groove UI scale, NOT the same scale as set_global_groove_amount which is 0.0-1.0).",
    schema: {
      groove_index: z.number().int().min(0),
      name: z.string().optional(),
      base: z.number().int().min(0).max(5).optional(),
      quantization_amount: z.number().min(0).max(100).optional(),
      random_amount: z.number().min(0).max(100).optional(),
      timing_amount: z.number().min(0).max(100).optional(),
      velocity_amount: z.number().min(0).max(100).optional(),
    },
    label: ({ groove_index }) => `set_groove(${groove_index})`,
    handler: async (args) => {
      const path = `live_set groove_pool grooves ${args.groove_index}`;
      if (args.name !== undefined) await lomSet(path, 'name', args.name);
      if (args.base !== undefined) await lomSet(path, 'base', args.base);
      if (args.quantization_amount !== undefined)
        await lomSet(path, 'quantization_amount', args.quantization_amount);
      if (args.random_amount !== undefined) await lomSet(path, 'random_amount', args.random_amount);
      if (args.timing_amount !== undefined) await lomSet(path, 'timing_amount', args.timing_amount);
      if (args.velocity_amount !== undefined)
        await lomSet(path, 'velocity_amount', args.velocity_amount);
    },
    successText: ({ groove_index }) => `Groove ${groove_index} updated`,
  });

  defineTool(server, {
    name: 'set_global_groove_amount',
    description:
      'Set the global groove amount (Song.groove_amount). This scales how strongly all grooves in the pool affect their assigned clips. Range 0.0-1.0.',
    schema: { value: z.number().min(0).max(1) },
    handler: ({ value }) => lomSet('live_set', 'groove_amount', value),
    successText: ({ value }) => `Global groove amount set to ${value}`,
  });

  defineTool(server, {
    name: 'set_clip_groove',
    description:
      'Assign a groove from the pool to a clip. Use get_grooves to find the index. Note: groove_index=-1 attempts to clear but Live silently ignores `Clip.groove = id 0` — to remove a groove, set it to a different one or remove via Live UI (Clip > Groove dropdown > None).',
    schema: {
      track: z.number().int().min(0),
      slot: z.number().int().min(0),
      groove_index: z
        .number()
        .int()
        .min(-1)
        .describe('Groove pool index, or -1 to remove the assigned groove'),
    },
    handler: ({ track, slot, groove_index }) => lomSetClipGroove(track, slot, groove_index),
    successText: ({ groove_index }) =>
      groove_index < 0 ? 'Clip groove cleared' : `Clip groove set to ${groove_index}`,
  });

  // ── Selection / Views ──

  defineTool(server, {
    name: 'get_selection',
    description:
      'Read the current UI selection state from Live. Returns JSON: { selected_track_index, selected_scene_index, highlighted_clip_slot: {track, slot} | null, detail_clip_path, selected_device_path, selected_chain_path }. Indices are -1 when nothing of that kind is selected. Paths are LOM canonical paths (e.g. "live_set tracks 0 devices 1") or null. Useful for interactive workflows where the agent reacts to what the user is focused on.',
    handler: () => lomGetSelection(),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'select_track',
    description:
      "Select a track in Live's UI (changes Song.View.selected_track). Affects which track is highlighted and is the target for some browser-load operations. Triggers UI redraws.",
    schema: { track: z.number().int().min(0) },
    handler: ({ track }) => lomSelectTrack(track),
    successText: ({ track }) => `Track ${track} selected`,
  });

  defineTool(server, {
    name: 'select_scene',
    description:
      "Select a scene in Live's UI (changes Song.View.selected_scene). Affects which scene is highlighted in Session View.",
    schema: { scene: z.number().int().min(0) },
    handler: ({ scene }) => lomSelectScene(scene),
    successText: ({ scene }) => `Scene ${scene} selected`,
  });

  defineTool(server, {
    name: 'set_swing_amount',
    description:
      'Set the global swing amount (0.0 to 1.0). Combined with the swing settings of individual clips/grooves, controls how much swing is applied during quantize and clip playback.',
    schema: { value: z.number().min(0).max(1) },
    handler: ({ value }) => lomSet('live_set', 'swing_amount', value),
    successText: ({ value }) => `Swing amount set to ${value}`,
  });
}

module.exports = { register };
