'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const { browserList, browserLoadItem, browserSearch, isAlive } = require('../extension/bridge');

/**
 * Format a uniform error message when the extension isn't reachable. Browser
 * tools require the Python Remote Script to be installed AND assigned in
 * Live's Preferences → Control Surface dropdown.
 *
 * @returns {Error}
 */
function extensionUnreachableError() {
  return new Error(
    'Browser API requires the agent4live Python extension. ' +
      'Install via `node tools/extension/install.js`, restart Live, and assign ' +
      '"agent4live" in Preferences → Tempo & MIDI → Control Surface.',
  );
}

/**
 * Throws a friendly error when the extension can't be reached, otherwise no-op.
 *
 * @returns {Promise<void>}
 */
async function ensureExtension() {
  const alive = await isAlive();
  if (!alive) throw extensionUnreachableError();
}

/**
 * @param {object} response - Whatever the Python extension returned.
 * @returns {object} The response if ok ; throws otherwise.
 */
function unwrap(response) {
  if (response && response.ok) return response;
  throw new Error((response && response.error) || 'extension returned an error');
}

/**
 * Register the Browser API tools on the MCP server. These are the only tools
 * that go through the Python extension (the other 214 use Max [js] LOM).
 *
 * @param {object} server
 */
function register(server) {
  defineTool(server, {
    name: 'browser_list_items',
    description:
      'List the children of a Browser node. Empty path = top-level roots ' +
      '(sounds, drums, instruments, audio_effects, midi_effects, plugins, ' +
      'samples, clips, user_library, current_project, packs). Slash-separated ' +
      "to descend (e.g. 'instruments/Drum Rack'). Returns JSON " +
      '[{name, uri, is_folder, is_loadable}, ...]. Requires the agent4live ' +
      'Python extension (Live → Preferences → Control Surface = agent4live).',
    schema: {
      path: z
        .string()
        .default('')
        .describe('Slash-separated browser path. Empty = top-level roots.'),
    },
    handler: async ({ path }) => {
      await ensureExtension();
      const r = unwrap(await browserList(path));
      return JSON.stringify(r.items);
    },
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'browser_load_item',
    description:
      'Load a Browser item (preset, instrument, sample, drum kit, audio effect, ' +
      'plugin, etc.) onto the currently-selected device hot-swap target. The ' +
      'path is the one returned in `browser_search` results (e.g. ' +
      "'/drums/Percussion Core Kit.adg') or built from `browser_list_items`. " +
      'Live places the item where its UI hot-swap target is — typically the ' +
      'selected track or device. For programmatic hot-swap of a specific ' +
      'device (replace its preset without manual UI focus), the sequence is: ' +
      'select_device(track, device) → toggle_browse() → browser_load_item(path) ' +
      '→ toggle_browse(). Requires the agent4live Python extension.',
    schema: {
      path: z
        .string()
        .min(1)
        .describe('Slash-separated path starting with a root attr name (drums, instruments, ...).'),
    },
    handler: async ({ path }) => {
      await ensureExtension();
      const r = unwrap(await browserLoadItem(path));
      return r.loaded;
    },
    successText: (_args, loaded) => `Loaded ${loaded}`,
  });

  defineTool(server, {
    name: 'browser_search',
    description:
      'Search the Browser tree by case-insensitive substring. Restrict to a ' +
      'single root via `root` (sounds | drums | instruments | audio_effects | ' +
      'midi_effects | plugins | samples | clips | user_library | ' +
      'current_project | packs). Returns JSON {results: [{name, path, ' +
      'is_loadable}], truncated}. Pass the returned `path` to ' +
      '`browser_load_item` to load the item. Requires the agent4live Python extension.',
    schema: {
      query: z.string().min(1).describe('Substring (case-insensitive)'),
      root: z.string().default('').describe('Optional root to restrict the search'),
      limit: z.number().int().min(1).max(200).default(50),
    },
    handler: async ({ query, root, limit }) => {
      await ensureExtension();
      const r = unwrap(await browserSearch(query, root, limit));
      return JSON.stringify({ results: r.results, truncated: r.truncated });
    },
    successText: (_args, json) => String(json),
  });
}

module.exports = { register };
