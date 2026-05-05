'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const { lomSet, lomCall } = require('../lom');

/**
 * Register the Session-view scene tools (fire, create, duplicate, delete,
 * select, scene-level tempo / time-signature) on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  defineTool(server, {
    name: 'fire_scene',
    description:
      'Launch all clips in a scene (a horizontal row across tracks) by 0-based scene index. Stops currently playing clips on those tracks first.',
    schema: { index: z.number().int().min(0).describe('Scene index (0-based)') },
    handler: ({ index }) => lomCall(`live_set scenes ${index}`, 'fire'),
    successText: ({ index }) => `Scene ${index} fired`,
  });

  defineTool(server, {
    name: 'set_scene_tempo_enabled',
    description:
      "Toggle whether a scene's custom tempo (set via set_scene_tempo) is applied when the scene is fired. When off, scene tempo is ignored ; song tempo continues.",
    schema: {
      scene: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ scene, on }) => lomSet(`live_set scenes ${scene}`, 'tempo_enabled', on ? 1 : 0),
    successText: ({ scene, on }) => `Scene ${scene} tempo_enabled ${on ? 'on' : 'off'}`,
  });

  defineTool(server, {
    name: 'set_scene_time_signature',
    description:
      'Set per-scene time signature. Pass numerator and/or denominator. Combined with set_scene_time_signature_enabled to actually apply when the scene is fired.',
    schema: {
      scene: z.number().int().min(0),
      numerator: z.number().int().min(1).max(99).optional(),
      denominator: z.number().int().min(1).optional(),
    },
    label: ({ scene, numerator, denominator }) =>
      `set_scene_time_signature(${scene},${numerator}/${denominator})`,
    handler: async ({ scene, numerator, denominator }) => {
      if (numerator === undefined && denominator === undefined) {
        throw new Error(
          'set_scene_time_signature: at least one of numerator / denominator required',
        );
      }
      const path = `live_set scenes ${scene}`;
      if (numerator !== undefined) await lomSet(path, 'time_signature_numerator', numerator);
      if (denominator !== undefined) await lomSet(path, 'time_signature_denominator', denominator);
    },
    successText: ({ scene }) => `Scene ${scene} time signature set`,
  });

  defineTool(server, {
    name: 'set_scene_time_signature_enabled',
    description:
      "Toggle whether a scene's custom time signature (set via set_scene_time_signature) is applied when the scene is fired.",
    schema: {
      scene: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ scene, on }) =>
      lomSet(`live_set scenes ${scene}`, 'time_signature_enabled', on ? 1 : 0),
    successText: ({ scene, on }) => `Scene ${scene} time_signature_enabled ${on ? 'on' : 'off'}`,
  });

  defineTool(server, {
    name: 'fire_scene_with_options',
    description:
      "Like fire_scene but with control over Live's legato + scene selection behavior. force_legato=true forces all triggered clips to play in sync at the same position (not from start). can_select_scene_on_launch=false prevents the auto-selection of the fired scene.",
    schema: {
      index: z.number().int().min(0),
      force_legato: z.boolean().optional(),
      can_select_scene_on_launch: z.boolean().optional(),
    },
    label: ({ index, force_legato, can_select_scene_on_launch }) =>
      `fire_scene_with_options(${index},legato=${force_legato},select=${can_select_scene_on_launch})`,
    handler: async ({ index, force_legato, can_select_scene_on_launch }) => {
      const path = `live_set scenes ${index}`;
      if (force_legato === undefined && can_select_scene_on_launch === undefined) {
        await lomCall(path, 'fire');
      } else if (can_select_scene_on_launch === undefined) {
        await lomCall(path, 'fire', force_legato ? 1 : 0);
      } else if (force_legato === undefined) {
        throw new Error(
          'can_select_scene_on_launch requires force_legato to also be provided (Live LOM constraint)',
        );
      } else {
        await lomCall(path, 'fire', force_legato ? 1 : 0, can_select_scene_on_launch ? 1 : 0);
      }
    },
    successText: ({ index }) => `Scene ${index} fired with options`,
  });

  defineTool(server, {
    name: 'fire_as_selected_scene',
    description:
      "Fire the currently selected scene, then auto-select the next scene. Useful for stepping through scenes one at a time. The receiver scene index doesn't matter — Live always uses the currently selected scene as the source.",
    schema: { force_legato: z.boolean().optional() },
    label: ({ force_legato }) => `fire_as_selected_scene(legato=${force_legato})`,
    handler: ({ force_legato }) =>
      // Need a path with a scene; use scene 0 as a stand-in (Live ignores the receiver per the doc).
      force_legato === undefined
        ? lomCall('live_set scenes 0', 'fire_as_selected')
        : lomCall('live_set scenes 0', 'fire_as_selected', force_legato ? 1 : 0),
    successText: 'Selected scene fired, next selected',
  });

  defineTool(server, {
    name: 'create_scene',
    description:
      'Create a new empty scene. By default appends at the end (index=-1). Optionally insert at a specific position (existing scenes shift down).',
    schema: { index: z.number().int().optional().describe('Insert position (-1 = end)') },
    handler: ({ index = -1 }) => lomCall('live_set', 'create_scene', index),
    successText: ({ index = -1 }) =>
      `Scene created${index === -1 ? ' at end' : ' at index ' + index}`,
  });

  defineTool(server, {
    name: 'delete_scene',
    description: 'Delete a scene by index. Cannot be undone via this tool — use the undo tool.',
    schema: { index: z.number().int().min(0).describe('Scene index to delete (0-based)') },
    handler: ({ index }) => lomCall('live_set', 'delete_scene', index),
    successText: ({ index }) => `Scene ${index} deleted`,
  });

  defineTool(server, {
    name: 'duplicate_scene',
    description:
      'Duplicate a scene at the given index. The new scene is inserted right after the source and contains the same clips.',
    schema: { index: z.number().int().min(0).describe('Source scene index (0-based)') },
    handler: ({ index }) => lomCall('live_set', 'duplicate_scene', index),
    successText: ({ index }) => `Scene ${index} duplicated`,
  });

  defineTool(server, {
    name: 'capture_and_insert_scene',
    description:
      'Capture the currently playing clips into a new scene and insert it after the highlighted scene. Mirrors Live\'s "Capture and Insert Scene" command — extremely useful for snapshotting a live performance into a recallable scene.',
    handler: () => lomCall('live_set', 'capture_and_insert_scene'),
    successText: 'Scene captured and inserted',
  });

  defineTool(server, {
    name: 'set_scene_name',
    description: 'Rename a scene.',
    schema: {
      index: z.number().int().min(0).describe('Scene index (0-based)'),
      name: z.string().describe('New scene name'),
    },
    handler: ({ index, name }) => lomSet(`live_set scenes ${index}`, 'name', name),
    successText: ({ index, name }) => `Scene ${index} renamed to "${name}"`,
  });

  defineTool(server, {
    name: 'set_scene_tempo',
    description:
      'Set a per-scene tempo (Live 11+). When the scene is launched, the song tempo changes to this value. Pass -1 to disable per-scene tempo (scene will inherit song tempo).',
    schema: {
      index: z.number().int().min(0).describe('Scene index (0-based)'),
      bpm: z.number().describe('Tempo in BPM, or -1 to disable'),
    },
    handler: ({ index, bpm }) => lomSet(`live_set scenes ${index}`, 'tempo', bpm),
    successText: ({ index, bpm }) =>
      bpm < 0
        ? `Scene ${index} tempo disabled (inherits song)`
        : `Scene ${index} tempo set to ${bpm} BPM`,
  });

  defineTool(server, {
    name: 'set_scene_color',
    description:
      "Set a scene's color as a 24-bit RGB integer (0xRRGGBB). Common values: red=0xFF0000, green=0x00FF00, blue=0x0000FF.",
    schema: {
      index: z.number().int().min(0).describe('Scene index (0-based)'),
      color: z
        .number()
        .int()
        .min(0)
        .max(0xffffff)
        .describe('RGB color as integer 0x000000-0xFFFFFF'),
    },
    label: ({ index, color }) => `set_scene_color(${index},${color.toString(16)})`,
    handler: ({ index, color }) => lomSet(`live_set scenes ${index}`, 'color', color),
    successText: ({ index, color }) =>
      `Scene ${index} color set to 0x${color.toString(16).toUpperCase().padStart(6, '0')}`,
  });
}

module.exports = { register };
