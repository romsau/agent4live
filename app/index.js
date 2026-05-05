'use strict';
// Max [node.script] resolves filenames at the patcher's flat search path —
// it doesn't descend into subfolders. So this thin entry sits at device/
// root and delegates to the real Node code in ./server/. Node's own
// require() handles the subfolder fine from here on.

// Excluded from Istanbul: this file is the Max boot trampoline. Jest
// sandboxes `require.extensions` per module (assignments are silently
// no-op'd from the runner's standpoint), so the hook installation can't
// be observed in unit tests. The end-to-end behavior is exercised when
// the .amxd loads in Max — coverage of meaning, not of statements.
/* istanbul ignore file */

// Allow `require('./active.html')` and `require('./guide.md')` in dev mode
// (unbundled). esbuild's text loader inlines both at build time, so these
// hooks are no-ops in prod — the bundled output has no remaining .html / .md
// requires to dispatch.
require.extensions['.html'] = function (mod, filename) {
  mod.exports = require('fs').readFileSync(filename, 'utf8');
};
require.extensions['.md'] = function (mod, filename) {
  mod.exports = require('fs').readFileSync(filename, 'utf8');
};

require('./server');
