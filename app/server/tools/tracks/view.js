'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet, lomCall, lomSelectDevice } = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.
const trackPath = (track) => `live_set tracks ${track}`;

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the track view tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Track view ──

  defineTool(server, {
    name: 'set_track_collapsed',
    description:
      "Collapse or expand a track's row in the Arrangement View. Affects only the UI, not playback. Use unfold via set_track_fold for Group Tracks (different concept).",
    schema: {
      track: z.number().int().min(0),
      on: z.boolean().describe('true = collapsed (narrow row), false = expanded'),
    },
    handler: ({ track, on }) => lomSet(`${trackPath(track)} view`, 'is_collapsed', on ? 1 : 0),
    successText: ({ track, on }) => `Track ${track} ${on ? 'collapsed' : 'expanded'}`,
  });

  defineTool(server, {
    name: 'select_track_instrument',
    description:
      "Select the track's instrument (or first device if no instrument), make it visible and focus it in the device chain. Live's UI scrolls to it. Returns false if there are no devices to select.",
    schema: { track: z.number().int().min(0) },
    handler: ({ track }) => lomCall(`${trackPath(track)} view`, 'select_instrument'),
    successText: ({ track }) => `Track ${track} instrument selected/focused`,
  });

  defineTool(server, {
    name: 'select_device',
    description:
      "Select a specific device on a track in Live's UI by its index in the device chain (0-based). Use get_track_devices to discover device indices. The selected device becomes the target for subsequent hot-swap operations and is the device shown in the Detail/DeviceChain view. Programmatic hot-swap workflow: select_device(track, device) → toggle_browse() → browser_load_item(path) → toggle_browse() to replace a device's preset without manual UI focus.",
    schema: {
      track: z.number().int().min(0).describe('Track index (0-based)'),
      device: z.number().int().min(0).describe('Device index within the track chain (0-based)'),
    },
    handler: ({ track, device }) => lomSelectDevice(track, device),
    successText: ({ track, device }) => `Device ${device} on track ${track} selected/focused`,
  });

  // NB: set_track_back_to_arranger pas exposé pour les mêmes raisons que
  // set_song_back_to_arranger — Live ignore silencieusement.
}

module.exports = { register };
