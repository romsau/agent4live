'use strict';

const { defineTool } = require('./define');
const { lomGet } = require('../lom');

/**
 * Register the tuning-systems tools (Live 12+) on the MCP server.
 *
 * Tuning Systems live under `live_set tuning_system` in the LOM. They are
 * available in Max [js] as plain LOM properties, so no extension is needed —
 * each tool here is a thin `lomGet` wrapper. The tuning system is read-only :
 * Live exposes the active system's metadata for inspection (microtonal grids,
 * relative cents per note, reference pitch). Switching tuning systems happens
 * via the Live UI (drag a `.ascl` / `.tun` onto a track) or by loading a Set
 * that already has one — there's no setter in the public LOM.
 *
 * @param {object} server
 */
function register(server) {
  defineTool(server, {
    name: 'get_tuning_system',
    description:
      "Return the currently active tuning system in Live (Live 12+). Returns JSON: {available, name?, pseudo_octave_in_cents?, lowest_note?, highest_note?, reference_pitch?, note_tunings?}. When `available` is false, the set has no custom tuning system loaded and Live is using the default 12-TET equal temperament — the metadata fields are omitted in that case. When `available` is true, `note_tunings` is an array of relative cents offsets that defines the microtonal grid. Read-only : switching systems isn't exposed in the LOM.",
    handler: async () => {
      const [name, octaveCents, lowest, highest, reference, noteTunings] = await Promise.all([
        lomGet('live_set tuning_system', 'name'),
        lomGet('live_set tuning_system', 'pseudo_octave_in_cents'),
        lomGet('live_set tuning_system', 'lowest_note'),
        lomGet('live_set tuning_system', 'highest_note'),
        lomGet('live_set tuning_system', 'reference_pitch'),
        lomGet('live_set tuning_system', 'note_tunings'),
      ]);
      // Live's LOM returns numeric 0 for every property when the set has no
      // custom tuning system loaded (the TuningSystem object exists but is
      // un-initialised). A real loaded system returns a non-empty `name`
      // symbol — that's the cleanest sentinel.
      if (!name || name === 0 || name === '0') {
        return JSON.stringify({
          available: false,
          note: 'No custom tuning system loaded ; Live is using the default 12-TET equal temperament.',
        });
      }
      return JSON.stringify({
        available: true,
        name,
        pseudo_octave_in_cents: octaveCents,
        lowest_note: lowest,
        highest_note: highest,
        reference_pitch: reference,
        note_tunings: noteTunings,
      });
    },
    successText: (_args, json) => String(json),
  });
}

module.exports = { register };
