'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const {
  lomSet,
  lomCall,
  lomGetRackChains,
  lomGetDrumPads,
  lomGetChainDevices,
  lomGetDrumPadChains,
  lomGetDrumPadChainDevices,
  lomGetChainDeviceParams,
  lomGetDrumPadChainDeviceParams,
  lomGetRackMacros,
  lomAddRackMacro,
  lomRemoveRackMacro,
  lomRandomizeRackMacros,
  lomStoreRackVariation,
  lomRecallRackVariation,
  lomRecallLastUsedVariation,
  lomDeleteRackVariation,
  lomInsertRackChain,
  lomCopyDrumPad,
  lomSetDrumChainProps,
} = require('../lom');

const chainPath = (track, device_index, chain_index) =>
  `live_set tracks ${track} devices ${device_index} chains ${chain_index}`;
const padPath = (track, device_index, pad_index) =>
  `live_set tracks ${track} devices ${device_index} drum_pads ${pad_index}`;

/**
 * Register the Rack tools (Instrument/Effect/Drum racks, chains, drum pads,
 * macros, variations) on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Discovery ────────────────────────────────────────────────────────────

  defineTool(server, {
    name: 'get_rack_chains',
    description:
      'List the chains of a regular Rack device (Audio Effect Rack, Instrument Rack — NOT Drum Rack). Returns JSON [{chain_idx, name, color, mute, solo, has_audio_input/output, has_midi_input/output, ...}]. For Drum Racks use get_drum_pads. For non-rack devices the list is empty. Color is RGB int 0xRRGGBB.',
    schema: {
      track: z.number().int().min(0).describe('Track index'),
      device_index: z.number().int().min(0).describe('Device index (must be a regular Rack)'),
    },
    handler: ({ track, device_index }) => lomGetRackChains(track, device_index),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_drum_pads',
    description:
      "List the pads of a Drum Rack. By default returns only the visible pads (the 16 in the matrix view). Set only_visible=false to get all 128 pads. Each entry: pad_idx, name, note (MIDI note that triggers the pad), mute, solo, chain_count (0 = empty pad). Use get_drum_pad_chains to inspect what's in a pad.",
    schema: {
      track: z.number().int().min(0).describe('Track index'),
      device_index: z.number().int().min(0).describe('Device index (must be a Drum Rack)'),
      only_visible: z.boolean().default(true).describe('Only return the 16 visible pads'),
    },
    handler: ({ track, device_index, only_visible }) =>
      lomGetDrumPads(track, device_index, only_visible),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_chain_devices',
    description:
      'List the devices inside a regular Rack chain. Returns same shape as get_track_devices: [{index, name, class_name}]. Use get_chain_device_params to read parameters of a specific nested device.',
    schema: {
      track: z.number().int().min(0).describe('Track index'),
      device_index: z.number().int().min(0).describe('Rack device index on the track'),
      chain_index: z.number().int().min(0).describe('Chain index within the rack'),
    },
    handler: ({ track, device_index, chain_index }) =>
      lomGetChainDevices(track, device_index, chain_index),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_drum_pad_chains',
    description:
      'List the chains nested under a Drum Rack pad. Drum-pad chains are DrumChain instances and add three properties on top of regular Chain props: in_note (the MIDI note that triggers the chain — -1 = "All Notes"), out_note (note sent to the chain\'s devices), choke_group (mutual-exclusion group, 0 = none). Returns [{chain_idx, name, mute, solo, in_note, out_note, choke_group}].',
    schema: {
      track: z.number().int().min(0).describe('Track index'),
      device_index: z.number().int().min(0).describe('Drum Rack device index'),
      pad_index: z
        .number()
        .int()
        .min(0)
        .max(127)
        .describe('Drum pad index (0-127, the MIDI note number)'),
    },
    handler: ({ track, device_index, pad_index }) =>
      lomGetDrumPadChains(track, device_index, pad_index),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_drum_pad_chain_devices',
    description:
      "List the devices inside a Drum Rack pad's chain (1 level deeper than get_chain_devices). Returns [{index, name, class_name}].",
    schema: {
      track: z.number().int().min(0).describe('Track index'),
      device_index: z.number().int().min(0).describe('Drum Rack device index'),
      pad_index: z.number().int().min(0).max(127).describe('Drum pad index'),
      chain_index: z.number().int().min(0).describe('Chain index within the pad'),
    },
    handler: ({ track, device_index, pad_index, chain_index }) =>
      lomGetDrumPadChainDevices(track, device_index, pad_index, chain_index),
    successText: (_args, json) => String(json),
  });

  // ── Params on nested devices ─────────────────────────────────────────────

  defineTool(server, {
    name: 'get_chain_device_params',
    description:
      'List parameters of a device nested in a regular Rack chain (1 level deep). Same shape as get_device_params.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Rack device index'),
      chain_index: z.number().int().min(0),
      sub_device_index: z
        .number()
        .int()
        .min(0)
        .describe('Index of the nested device within the chain'),
    },
    handler: ({ track, device_index, chain_index, sub_device_index }) =>
      lomGetChainDeviceParams(track, device_index, chain_index, sub_device_index),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_chain_device_param',
    description:
      'Set a parameter of a device nested in a regular Rack chain. Same semantics as set_device_param but addresses through the rack chain.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Rack device index'),
      chain_index: z.number().int().min(0),
      sub_device_index: z.number().int().min(0),
      param_index: z.number().int().min(0),
      value: z.number(),
    },
    handler: ({ track, device_index, chain_index, sub_device_index, param_index, value }) =>
      lomSet(
        `${chainPath(track, device_index, chain_index)} devices ${sub_device_index} parameters ${param_index}`,
        'value',
        value,
      ),
    successText: ({ param_index, value }) => `Param ${param_index} set to ${value}`,
  });

  defineTool(server, {
    name: 'get_drum_pad_chain_device_params',
    description:
      "List parameters of a device nested under a Drum Rack pad's chain (2 levels deep — pad → chain → device). Same shape as get_device_params.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Drum Rack device index'),
      pad_index: z.number().int().min(0).max(127),
      chain_index: z.number().int().min(0),
      sub_device_index: z.number().int().min(0),
    },
    handler: ({ track, device_index, pad_index, chain_index, sub_device_index }) =>
      lomGetDrumPadChainDeviceParams(track, device_index, pad_index, chain_index, sub_device_index),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_drum_pad_chain_device_param',
    description:
      "Set a parameter on a device nested under a Drum Rack pad's chain (2 levels deep).",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      pad_index: z.number().int().min(0).max(127),
      chain_index: z.number().int().min(0),
      sub_device_index: z.number().int().min(0),
      param_index: z.number().int().min(0),
      value: z.number(),
    },
    handler: ({
      track,
      device_index,
      pad_index,
      chain_index,
      sub_device_index,
      param_index,
      value,
    }) =>
      lomSet(
        `${padPath(track, device_index, pad_index)} chains ${chain_index} devices ${sub_device_index} parameters ${param_index}`,
        'value',
        value,
      ),
    successText: ({ param_index, value }) => `Param ${param_index} set to ${value}`,
  });

  // ── Macros + variations ──────────────────────────────────────────────────

  defineTool(server, {
    name: 'get_rack_macros',
    description:
      'Read a Rack\'s macro state in one call. Returns JSON: { visible_macro_count, variation_count, selected_variation_index, has_macro_mappings, macros: [{index, name, value, min, max}] }. macros is filtered to parameters whose name starts with "Macro " (Macro 1..16). visible_macro_count is the number currently shown in the UI (use add_rack_macro / remove_rack_macro to change it).',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Rack device index'),
    },
    handler: ({ track, device_index }) => lomGetRackMacros(track, device_index),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'add_rack_macro',
    description:
      'Increase the number of visible macro controls on a Rack by 1 (up to 16). Live 11+. No-op if already at max.',
    schema: { track: z.number().int().min(0), device_index: z.number().int().min(0) },
    handler: ({ track, device_index }) => lomAddRackMacro(track, device_index),
    successText: 'Macro added',
  });

  defineTool(server, {
    name: 'remove_rack_macro',
    description:
      'Decrease the number of visible macro controls on a Rack by 1. Live 11+. No-op if already at minimum.',
    schema: { track: z.number().int().min(0), device_index: z.number().int().min(0) },
    handler: ({ track, device_index }) => lomRemoveRackMacro(track, device_index),
    successText: 'Macro removed',
  });

  defineTool(server, {
    name: 'randomize_rack_macros',
    description:
      'Randomize the values of eligible macro controls on a Rack. Live 11+. Useful for sound design exploration.',
    schema: { track: z.number().int().min(0), device_index: z.number().int().min(0) },
    handler: ({ track, device_index }) => lomRandomizeRackMacros(track, device_index),
    successText: 'Macros randomized',
  });

  defineTool(server, {
    name: 'store_rack_variation',
    description:
      'Snapshot the current macro values as a new variation on the Rack. Live 11+. Variations are recallable presets of macro states. The new variation becomes the selected one.',
    schema: { track: z.number().int().min(0), device_index: z.number().int().min(0) },
    handler: ({ track, device_index }) => lomStoreRackVariation(track, device_index),
    successText: 'Variation stored',
  });

  defineTool(server, {
    name: 'recall_rack_variation',
    description:
      'Recall a stored macro variation by index, or recall the currently selected one if variation_index is omitted (-1). To recall the most recently used variation regardless of selection, use recall_last_used_rack_variation.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      variation_index: z
        .number()
        .int()
        .optional()
        .describe('Variation index (omit to recall currently selected)'),
    },
    handler: ({ track, device_index, variation_index }) =>
      lomRecallRackVariation(track, device_index, variation_index),
    successText: ({ variation_index }) => `Variation ${variation_index ?? '(selected)'} recalled`,
  });

  defineTool(server, {
    name: 'recall_last_used_rack_variation',
    description:
      'Recall the macro variation that was most recently recalled (Live 11+). Useful for quick A/B between current state and last variation.',
    schema: { track: z.number().int().min(0), device_index: z.number().int().min(0) },
    handler: ({ track, device_index }) => lomRecallLastUsedVariation(track, device_index),
    successText: 'Last variation recalled',
  });

  defineTool(server, {
    name: 'delete_rack_variation',
    description: 'Delete the currently selected macro variation. No-op if none selected.',
    schema: { track: z.number().int().min(0), device_index: z.number().int().min(0) },
    handler: ({ track, device_index }) => lomDeleteRackVariation(track, device_index),
    successText: 'Variation deleted',
  });

  // ── Misc actions ─────────────────────────────────────────────────────────

  defineTool(server, {
    name: 'insert_rack_chain',
    description:
      'Insert a new (empty) chain in a regular Rack at the given position, or at the end if position is omitted. Live 12.3+. Throws if not allowed (e.g. some Drum Rack constraints).',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      position: z.number().int().min(0).optional().describe('Insert position (omit = end)'),
    },
    handler: ({ track, device_index, position }) =>
      lomInsertRackChain(track, device_index, position),
    successText: ({ position }) => `Chain inserted at ${position ?? 'end'}`,
  });

  defineTool(server, {
    name: 'insert_chain_device',
    description:
      "Insert a native Ableton device into a Rack chain at a given position (or at the end if target_index omitted). Live 12.3+ only. Same constraints as insert_device: native devices only, ordering rules apply. For inserting into a Drum Rack pad's chain, use the Track-level insert_device into the right path — we don't expose drum-pad chain insert separately as Drum Rack chains receive devices via Live's standard pad-drop UI.",
    schema: {
      track: z.number().int().min(0).describe('Track index'),
      device_index: z.number().int().min(0).describe('Rack device index'),
      chain_index: z.number().int().min(0).describe('Chain index within the rack'),
      device_name: z.string().describe('Native device name (e.g. "Reverb", "EQ Eight")'),
      target_index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Insert position within the chain (omit = end)'),
    },
    handler: ({ track, device_index, chain_index, device_name, target_index }) => {
      const path = chainPath(track, device_index, chain_index);
      return target_index === undefined
        ? lomCall(path, 'insert_device', device_name)
        : lomCall(path, 'insert_device', device_name, target_index);
    },
    successText: ({ chain_index, device_name }) =>
      `Inserted "${device_name}" in chain ${chain_index}`,
  });

  defineTool(server, {
    name: 'delete_chain_device',
    description:
      'Remove a device from a Rack chain by its index within that chain. Live 12.3+. Use get_chain_devices to find the index first.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Rack device index'),
      chain_index: z.number().int().min(0),
      sub_device_index: z.number().int().min(0).describe('Index of the device within the chain'),
    },
    handler: ({ track, device_index, chain_index, sub_device_index }) =>
      lomCall(chainPath(track, device_index, chain_index), 'delete_device', sub_device_index),
    successText: ({ chain_index, sub_device_index }) =>
      `Deleted device ${sub_device_index} from chain ${chain_index}`,
  });

  // ── Chain properties (regular Rack chain) ──
  // For Drum Rack chain props (in_note/out_note/choke_group), use
  // set_drum_chain_props. The setters below address `chains` directly,
  // so they target Audio/Instrument Rack chains, not chains nested
  // inside Drum Pads.

  defineTool(server, {
    name: 'set_chain_name',
    description: 'Rename a chain inside a regular Rack (Audio Effect Rack, Instrument Rack).',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Rack device index'),
      chain_index: z.number().int().min(0),
      name: z.string(),
    },
    handler: ({ track, device_index, chain_index, name }) =>
      lomSet(chainPath(track, device_index, chain_index), 'name', name),
    successText: ({ chain_index, name }) => `Chain ${chain_index} renamed to "${name}"`,
  });

  defineTool(server, {
    name: 'set_chain_color',
    description:
      "Set a Rack chain's color (24-bit RGB integer 0xRRGGBB). Live snaps to nearest palette color.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      chain_index: z.number().int().min(0),
      color: z.number().int().min(0).max(0xffffff),
    },
    handler: ({ track, device_index, chain_index, color }) =>
      lomSet(chainPath(track, device_index, chain_index), 'color', color),
    successText: ({ chain_index, color }) =>
      `Chain ${chain_index} color set to 0x${color.toString(16).toUpperCase().padStart(6, '0')}`,
  });

  defineTool(server, {
    name: 'set_chain_mute',
    description:
      'Mute or unmute a Rack chain (toggles the Chain Activator switch). Use to A/B chains within an effect rack.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      chain_index: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ track, device_index, chain_index, on }) =>
      lomSet(chainPath(track, device_index, chain_index), 'mute', on ? 1 : 0),
    successText: ({ chain_index, on }) => `Chain ${chain_index} ${on ? 'muted' : 'unmuted'}`,
  });

  defineTool(server, {
    name: 'set_chain_solo',
    description:
      "Solo or unsolo a Rack chain. Doesn't auto-unsolo other chains (unlike track solo when exclusive_solo is on).",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      chain_index: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ track, device_index, chain_index, on }) =>
      lomSet(chainPath(track, device_index, chain_index), 'solo', on ? 1 : 0),
    successText: ({ chain_index, on }) => `Chain ${chain_index} ${on ? 'soloed' : 'un-soloed'}`,
  });

  defineTool(server, {
    name: 'set_chain_auto_colored',
    description:
      'When on, the chain inherits the color of the containing track or chain. When off, the chain keeps its custom color.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      chain_index: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ track, device_index, chain_index, on }) =>
      lomSet(chainPath(track, device_index, chain_index), 'is_auto_colored', on ? 1 : 0),
    successText: ({ chain_index, on }) => `Chain ${chain_index} auto-color ${on ? 'on' : 'off'}`,
  });

  // ── DrumPad properties ──

  defineTool(server, {
    name: 'set_drum_pad_name',
    description:
      'Rename a Drum Rack pad. Useful for labeling beyond the default kit names (e.g. "Kick", "Snare", "Hat").',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Drum Rack device index'),
      pad_index: z.number().int().min(0).max(127).describe('Drum pad index (= MIDI note)'),
      name: z.string(),
    },
    handler: ({ track, device_index, pad_index, name }) =>
      lomSet(padPath(track, device_index, pad_index), 'name', name),
    successText: ({ pad_index, name }) => `Drum pad ${pad_index} renamed to "${name}"`,
  });

  // NB: DrumPad.note n'est pas exposé comme setter. drum_pads est indexé par
  // MIDI note (drum_pads[36] = pad triggered par note 36), donc structurellement
  // read-only. Voir LOM_NOTES.md.

  defineTool(server, {
    name: 'set_drum_pad_mute',
    description:
      'Mute or unmute a Drum Rack pad (the pad activator). Different from muting a specific chain inside the pad.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      pad_index: z.number().int().min(0).max(127),
      on: z.boolean(),
    },
    handler: ({ track, device_index, pad_index, on }) =>
      lomSet(padPath(track, device_index, pad_index), 'mute', on ? 1 : 0),
    successText: ({ pad_index, on }) => `Drum pad ${pad_index} ${on ? 'muted' : 'unmuted'}`,
  });

  defineTool(server, {
    name: 'set_drum_pad_solo',
    description: 'Solo or unsolo a Drum Rack pad.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      pad_index: z.number().int().min(0).max(127),
      on: z.boolean(),
    },
    handler: ({ track, device_index, pad_index, on }) =>
      lomSet(padPath(track, device_index, pad_index), 'solo', on ? 1 : 0),
    successText: ({ pad_index, on }) => `Drum pad ${pad_index} ${on ? 'soloed' : 'un-soloed'}`,
  });

  defineTool(server, {
    name: 'copy_drum_pad',
    description:
      "Copy the entire content of a Drum Rack pad (chain + devices) from source to destination. The destination pad's previous content is replaced. Source and destination indices are MIDI notes (0-127).",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Drum Rack device index'),
      source_pad_index: z.number().int().min(0).max(127),
      destination_pad_index: z.number().int().min(0).max(127),
    },
    handler: ({ track, device_index, source_pad_index, destination_pad_index }) =>
      lomCopyDrumPad(track, device_index, source_pad_index, destination_pad_index),
    successText: ({ source_pad_index, destination_pad_index }) =>
      `Pad ${source_pad_index} → ${destination_pad_index}`,
  });

  defineTool(server, {
    name: 'remap_drum_pad',
    description:
      "Move a Drum Rack pad to a different MIDI note. Equivalent to drag-drop in Live's GUI: copies the source pad's content (chain + devices) to the destination, then clears the source. Use this to re-key a sound (e.g. move a kick from C2/36 to E2/40 without manually copying then deleting). The destination pad's previous content is replaced. NB: drum_pads is structurally indexed by MIDI note in the LOM — DrumPad.note is read-only — so a \"remap\" is implemented as copy + clear under the hood.",
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0).describe('Drum Rack device index'),
      source_note: z
        .number()
        .int()
        .min(0)
        .max(127)
        .describe('Source MIDI note (= source pad index)'),
      destination_note: z.number().int().min(0).max(127).describe('Destination MIDI note'),
    },
    handler: async ({ track, device_index, source_note, destination_note }) => {
      if (source_note === destination_note) {
        throw new Error('remap_drum_pad: source and destination notes must differ');
      }
      // Two queued LOM ops : copy first, then clear the source pad. The
      // queue ensures both run before any other op interleaves.
      await lomCopyDrumPad(track, device_index, source_note, destination_note);
      await lomCall(padPath(track, device_index, source_note), 'delete_all_chains');
    },
    successText: ({ source_note, destination_note }) =>
      `Drum pad note ${source_note} remapped to ${destination_note} (source cleared)`,
  });

  defineTool(server, {
    name: 'set_drum_chain_props',
    description:
      'Set in_note / out_note / choke_group on a DrumChain (chain inside a Drum Rack pad). Pass only the fields you want to change. in_note=-1 means "All Notes" (the chain triggers on any MIDI note). choke_group=0 = no choke group; 1-16 = group N.',
    schema: {
      track: z.number().int().min(0),
      device_index: z.number().int().min(0),
      pad_index: z.number().int().min(0).max(127),
      chain_index: z.number().int().min(0),
      in_note: z.number().int().min(-1).max(127).optional(),
      out_note: z.number().int().min(0).max(127).optional(),
      choke_group: z.number().int().min(0).max(16).optional(),
    },
    handler: async ({
      track,
      device_index,
      pad_index,
      chain_index,
      in_note,
      out_note,
      choke_group,
    }) => {
      if (in_note === undefined && out_note === undefined && choke_group === undefined) {
        throw new Error(
          'set_drum_chain_props: at least one of in_note / out_note / choke_group required',
        );
      }
      return lomSetDrumChainProps(
        track,
        device_index,
        pad_index,
        chain_index,
        in_note,
        out_note,
        choke_group,
      );
    },
    successText: 'DrumChain props updated',
  });
}

module.exports = { register };
