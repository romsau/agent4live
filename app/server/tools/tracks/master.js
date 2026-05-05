'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet } = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.
const masterMixerPath = 'live_set master_track mixer_device';

const colorHex = (color) => `0x${color.toString(16).toUpperCase().padStart(6, '0')}`;

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the master track tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Master track ──

  defineTool(server, {
    name: 'set_master_volume',
    description:
      'Set the master track volume. Same 0.0-1.0 LOM units as regular tracks (≈0.85 = 0 dB).',
    schema: { value: z.number().min(0).max(1).describe('Volume 0.0-1.0') },
    handler: ({ value }) => lomSet(`${masterMixerPath} volume`, 'value', value),
    successText: ({ value }) => `Master volume set to ${value}`,
  });

  defineTool(server, {
    name: 'set_master_panning',
    description: 'Set the master track pan. -1.0 = full left, 1.0 = full right, 0.0 = center.',
    schema: { value: z.number().min(-1).max(1).describe('Pan -1.0 to 1.0') },
    handler: ({ value }) => lomSet(`${masterMixerPath} panning`, 'value', value),
    successText: ({ value }) => `Master panning set to ${value}`,
  });

  defineTool(server, {
    name: 'set_master_cue_volume',
    description:
      'Set the cue (headphone) volume on the master track. Only applicable on master. Same 0.0-1.0 range as regular volume.',
    schema: { value: z.number().min(0).max(1).describe('Cue volume 0.0-1.0') },
    handler: ({ value }) => lomSet(`${masterMixerPath} cue_volume`, 'value', value),
    successText: ({ value }) => `Master cue volume set to ${value}`,
  });

  // NB: Track.name on master_track is technically settable per LOM doc but
  // Live 12 silently ignores the set. Tool not exposed — see LOM_NOTES.md.

  defineTool(server, {
    name: 'set_master_color',
    description: "Set the master track's color (24-bit RGB integer 0xRRGGBB).",
    schema: { color: z.number().int().min(0).max(0xffffff) },
    handler: ({ color }) => lomSet('live_set master_track', 'color', color),
    successText: ({ color }) => `Master color set to ${colorHex(color)}`,
  });
}

module.exports = { register };
