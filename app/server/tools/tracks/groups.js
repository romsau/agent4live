'use strict';

// AUTO-AUTHORED — split out from app/server/tools/tracks.js.
// Each per-section file exposes its own register(server) ; the index.js
// orchestrator chains them.

const { z } = require('zod');
const { defineTool } = require('../define');
const { lomSet, lomGetTrackGroupInfo } = require('../../lom');

// Path helpers — DRY for the LOM hierarchy.
const trackPath = (track) => `live_set tracks ${track}`;

/**
 * Register the track tools (creation, mixer, devices, routing, take lanes,
 * solo / mute, color, and the global session-state snapshot) on the MCP server.
 *
 * @param {object} server
 */

/**
 * Register the group tracks tools on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  // ── Group tracks ──

  defineTool(server, {
    name: 'get_track_group_info',
    description:
      "Read group/fold state of a track in one call. Returns JSON: { is_foldable (true if it's a Group Track), is_grouped (true if this track is inside another Group Track), fold_state (0=expanded, 1=folded — only meaningful if is_foldable), group_track_index (index of parent Group Track, or -1 if top-level) }. Use this to navigate the track hierarchy.",
    schema: { track: z.number().int().min(0) },
    handler: ({ track }) => lomGetTrackGroupInfo(track),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'set_track_fold',
    description:
      'Fold or unfold a Group Track (collapse/expand its children in the mixer view). No-op on non-Group tracks (read is_foldable from get_track_group_info first). on=true folds (hides children), on=false unfolds.',
    schema: {
      track: z.number().int().min(0),
      on: z.boolean(),
    },
    handler: ({ track, on }) => lomSet(trackPath(track), 'fold_state', on ? 1 : 0),
    successText: ({ track, on }) => `Track ${track} ${on ? 'folded' : 'unfolded'}`,
  });
}

module.exports = { register };
