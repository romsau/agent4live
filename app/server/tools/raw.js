'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const { lomGet, lomSet, lomCall } = require('../lom');

const pathTag = (lomPath) => lomPath.replace(/ /g, '_');

/**
 * Register the raw LOM tools (`lom_get` / `lom_set` / `lom_call`) on the MCP
 * server. These are the escape hatch for properties/methods not yet wrapped
 * by a semantic tool.
 *
 * @param {object} server
 */
function register(server) {
  defineTool(server, {
    name: 'lom_get',
    description:
      'Read a raw property from the Ableton Live Object Model (advanced). Use when no semantic tool covers your need. The path is space-separated (e.g. "live_set tracks 0 mixer_device volume"). Returns the property value as a string.',
    schema: {
      path: z.string().describe('LOM path, e.g. "live_set tracks 0"'),
      property: z.string().describe('Property name, e.g. "name"'),
    },
    label: ({ path, property }) => `lom_get(${pathTag(path)},${property})`,
    handler: ({ path, property }) => lomGet(path, property),
    successText: (_args, value) => String(value),
  });

  defineTool(server, {
    name: 'lom_set',
    description:
      'Write a raw property to the Ableton Live Object Model (advanced). Use when no semantic tool covers your need. The path is space-separated (e.g. "live_set tracks 0 mixer_device volume"). Property must be writable — read-only props will silently no-op without error. Always read back with lom_get to verify the change took effect.',
    schema: {
      path: z.string().describe('LOM path, e.g. "live_set tracks 0 mixer_device volume"'),
      property: z.string().describe('Property name, e.g. "value"'),
      value: z
        .union([z.string(), z.number(), z.boolean()])
        .describe('New value (atom: string, number, or boolean)'),
    },
    label: ({ path, property }) => `lom_set(${pathTag(path)},${property})`,
    handler: ({ path, property, value }) => lomSet(path, property, value),
    successText: ({ path, property, value }) => `Set ${property} on ${path} to ${value}`,
  });

  defineTool(server, {
    name: 'lom_call',
    description:
      'Call a method on a Live Object Model object (advanced). Use when no semantic tool covers your need. The path is space-separated. The method takes 0 or 1 simple atom argument (string, number, or boolean). Methods that need a Dict (e.g. add_new_notes, apply_note_modifications) require a dedicated tool — passing JSON here will silently no-op without error.',
    schema: {
      path: z.string().describe('LOM path, e.g. "live_set tracks 0"'),
      method: z.string().describe('Method name, e.g. "stop_all_clips"'),
      arg: z
        .union([z.string(), z.number(), z.boolean()])
        .optional()
        .describe('Optional single atom argument'),
    },
    label: ({ path, method }) => `lom_call(${pathTag(path)},${method})`,
    handler: ({ path, method, arg }) => lomCall(path, method, arg),
    successText: ({ path, method }) => `Called ${method} on ${path}`,
  });
}

module.exports = { register };
