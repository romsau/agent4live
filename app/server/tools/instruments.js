'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const { lomSet, lomCall } = require('../lom');

// Tools spécifiques à Simpler / Looper / Sample (instruments natifs Ableton
// dont certaines properties top-level ne sont PAS exposées dans le
// parameters list — donc inaccessibles via set_device_param). Toutes Case A
// simples via lomSet/lomCall sur le path direct du device ou de Sample.

const devicePath = (track, device_index) => `live_set tracks ${track} devices ${device_index}`;
const samplePath = (track, device_index) => `${devicePath(track, device_index)} sample`;

/**
 * Register the native-instrument tools (Simpler, Sample, Looper) on the MCP
 * server. These cover top-level properties not exposed via the parameters
 * list — i.e. inaccessible via set_device_param.
 *
 * @param {object} server
 */
function register(server) {
  // ── Simpler top-level properties ──────────────────────────────────────────

  defineTool(server, {
    name: 'set_simpler_playback_mode',
    description:
      "Set Simpler's playback mode. 0=Classic (mono pitched playback), 1=One-Shot (no envelope), 2=Slicing (chops sample into slices triggered by MIDI notes).",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Simpler device index'),
      mode: z.number().int().min(0).max(2).describe('0=Classic, 1=One-Shot, 2=Slicing'),
    },
    handler: ({ track, device_index, mode }) =>
      lomSet(devicePath(track, device_index), 'playback_mode', mode),
    successText: ({ mode }) => `Simpler playback_mode set to ${mode}`,
  });

  defineTool(server, {
    name: 'set_simpler_slicing_playback_mode',
    description:
      "Set Simpler's slice playback mode (only meaningful when playback_mode=2 Slicing). 0=Mono (slices steal voice), 1=Poly (slices stack), 2=Thru (slice plays till end regardless).",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      mode: z.number().int().min(0).max(2).describe('0=Mono, 1=Poly, 2=Thru'),
    },
    handler: ({ track, device_index, mode }) =>
      lomSet(devicePath(track, device_index), 'slicing_playback_mode', mode),
    successText: ({ mode }) => `Simpler slicing_playback_mode set to ${mode}`,
  });

  defineTool(server, {
    name: 'set_simpler_voices',
    description:
      "Set Simpler's polyphony (number of voices that can play simultaneously). 1-32 typical range. Higher = more CPU.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      voices: z.number().int().min(1).max(64),
    },
    handler: ({ track, device_index, voices }) =>
      lomSet(devicePath(track, device_index), 'voices', voices),
    successText: ({ voices }) => `Simpler voices set to ${voices}`,
  });

  defineTool(server, {
    name: 'set_simpler_retrigger',
    description:
      "Toggle Simpler's retrigger mode. When on, re-pressing the same note before release re-triggers the envelope ; when off, the note re-uses the existing voice.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ track, device_index, on }) =>
      lomSet(devicePath(track, device_index), 'retrigger', on ? 1 : 0),
    successText: ({ on }) => `Simpler retrigger ${on ? 'on' : 'off'}`,
  });

  defineTool(server, {
    name: 'set_simpler_multi_sample_mode',
    description:
      "Toggle Simpler's Multi-Sample mode (Live 12+). When on, multiple samples can be loaded into the Simpler and triggered by velocity / key zones.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ track, device_index, on }) =>
      lomSet(devicePath(track, device_index), 'multi_sample_mode', on ? 1 : 0),
    successText: ({ on }) => `Simpler multi_sample_mode ${on ? 'on' : 'off'}`,
  });

  // ── Looper top-level properties ───────────────────────────────────────────

  defineTool(server, {
    name: 'set_looper_overdub_after_record',
    description:
      'Toggle Looper\'s "switch to overdub after recording" behavior. When on, after a fixed-length recording finishes, the Looper enters overdub mode automatically.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Looper device index'),
      on: z.boolean(),
    },
    handler: ({ track, device_index, on }) =>
      lomSet(devicePath(track, device_index), 'overdub_after_record', on ? 1 : 0),
    successText: ({ on }) => `Looper overdub_after_record ${on ? 'on' : 'off'}`,
  });

  defineTool(server, {
    name: 'set_looper_record_length_index',
    description:
      "Set Looper's \"Record Length\" chooser to a specific bar length index. The exact mapping depends on Live's chooser (typically 0=x1, then doubling). Combined with Looper's state machine to control auto-stop after N bars.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      index: z.number().int().min(0).describe('Index into the Record Length chooser'),
    },
    handler: ({ track, device_index, index }) =>
      lomSet(devicePath(track, device_index), 'record_length_index', index),
    successText: ({ index }) => `Looper record_length_index set to ${index}`,
  });

  // ── Sample (Simpler-loaded) properties ────────────────────────────────────
  // Path: live_set tracks <track> devices <device_index> sample
  // Only meaningful on Simpler devices that have a sample loaded.

  defineTool(server, {
    name: 'set_sample_slicing_sensitivity',
    description:
      "Set the sample's slice detection sensitivity (Simpler Slicing mode). Range 0.0-1.0. Higher = more transients detected as slice boundaries when slicing_style is transient-based.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Simpler device index'),
      sensitivity: z.number().min(0).max(1),
    },
    handler: ({ track, device_index, sensitivity }) =>
      lomSet(samplePath(track, device_index), 'slicing_sensitivity', sensitivity),
    successText: ({ sensitivity }) => `Sample slicing_sensitivity set to ${sensitivity}`,
  });

  defineTool(server, {
    name: 'set_sample_slicing_beat_division',
    description:
      'Set the beat division for beat-based slicing (Simpler Slicing mode). Integer divisor — see slicing_style for which slicing mode is active.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      division: z.number().int().min(1),
    },
    handler: ({ track, device_index, division }) =>
      lomSet(samplePath(track, device_index), 'slicing_beat_division', division),
    successText: ({ division }) => `Sample slicing_beat_division set to ${division}`,
  });

  defineTool(server, {
    name: 'set_sample_slicing_region_count',
    description:
      'Set the target slice region count for region-based slicing (Simpler Slicing mode). Splits the sample into N equal regions.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      count: z.number().int().min(1),
    },
    handler: ({ track, device_index, count }) =>
      lomSet(samplePath(track, device_index), 'slicing_region_count', count),
    successText: ({ count }) => `Sample slicing_region_count set to ${count}`,
  });

  defineTool(server, {
    name: 'set_sample_mode_params',
    description:
      'Bundle setter for Simpler Sample mode-specific params (Beats / Tones / Texture / Complex Pro warp modes). Pass only the fields you want to change. All optional. Each field corresponds to a property of the Sample object.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Simpler device index'),
      beats_granulation_resolution: z
        .number()
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe('Beats Mode grain (0=1 Bar, 1=1/2, 2=1/4, 3=1/8, 4=1/16, 5=1/32, 6=Transients)'),
      beats_transient_envelope: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe('Beats Mode segment fade (0=fastest, 100=no fade)'),
      beats_transient_loop_mode: z
        .number()
        .int()
        .min(0)
        .max(2)
        .optional()
        .describe('Beats Mode transient loop (0=Off, 1=Forward, 2=Back-and-Forth)'),
      complex_pro_envelope: z.number().optional().describe('Complex Pro Envelope param'),
      complex_pro_formants: z.number().optional().describe('Complex Pro Formants param'),
      texture_flux: z.number().optional().describe('Texture Mode flux'),
      texture_grain_size: z.number().optional().describe('Texture Mode grain size'),
      tones_grain_size: z.number().optional().describe('Tones Mode grain size'),
    },
    label: ({ track, device_index }) => `set_sample_mode_params(${track},${device_index})`,
    handler: async (args) => {
      const path = samplePath(args.track, args.device_index);
      const props = [
        'beats_granulation_resolution',
        'beats_transient_envelope',
        'beats_transient_loop_mode',
        'complex_pro_envelope',
        'complex_pro_formants',
        'texture_flux',
        'texture_grain_size',
        'tones_grain_size',
      ];
      for (const prop of props) {
        if (args[prop] !== undefined) await lomSet(path, prop, args[prop]);
      }
    },
    successText: ({ track, device_index }) =>
      `Sample mode params updated on device ${device_index} of track ${track}`,
  });

  // ── Sample slice methods ──────────────────────────────────────────────────

  defineTool(server, {
    name: 'insert_sample_slice',
    description:
      'Insert a slice marker at a specific time in the sample (Simpler Slicing mode). slice_time is in samples.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      slice_time: z.number().min(0).describe('Slice position in samples'),
    },
    handler: ({ track, device_index, slice_time }) =>
      lomCall(samplePath(track, device_index), 'insert_slice', slice_time),
    successText: ({ slice_time }) => `Slice inserted at ${slice_time}`,
  });

  defineTool(server, {
    name: 'move_sample_slice',
    description: 'Move a slice marker from source_time to dest_time (in samples).',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      source_time: z.number().min(0).describe('Current position of the slice in samples'),
      dest_time: z.number().min(0).describe('New position in samples'),
    },
    label: ({ track, device_index, source_time, dest_time }) =>
      `move_sample_slice(${track},${device_index},${source_time}→${dest_time})`,
    handler: ({ track, device_index, source_time, dest_time }) =>
      lomCall(samplePath(track, device_index), 'move_slice', source_time, dest_time),
    successText: ({ source_time, dest_time }) => `Slice moved from ${source_time} to ${dest_time}`,
  });

  defineTool(server, {
    name: 'remove_sample_slice',
    description: 'Remove a slice marker at a specific time (in samples). Time must match exactly.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      slice_time: z.number().min(0),
    },
    handler: ({ track, device_index, slice_time }) =>
      lomCall(samplePath(track, device_index), 'remove_slice', slice_time),
    successText: ({ slice_time }) => `Slice removed at ${slice_time}`,
  });

  defineTool(server, {
    name: 'clear_sample_slices',
    description:
      'Remove ALL user-inserted slice markers from the sample. Auto-detected slices remain.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
    },
    handler: ({ track, device_index }) => lomCall(samplePath(track, device_index), 'clear_slices'),
    successText: 'All user slices cleared',
  });

  defineTool(server, {
    name: 'reset_sample_slices',
    description:
      'Reset slices to the default state for the current slicing_style (e.g. re-detect transients, or re-snap to beat grid).',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
    },
    handler: ({ track, device_index }) => lomCall(samplePath(track, device_index), 'reset_slices'),
    successText: 'Slices reset to default',
  });
}

module.exports = { register };
