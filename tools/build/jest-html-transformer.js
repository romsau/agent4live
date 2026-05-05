'use strict';

// Tiny Jest transformer that turns *.html files into a CommonJS module
// exporting their content as a string — matches the `require.extensions`
// hook the dev-server installs at runtime, so server/ui/state.js can
// `require('./active.html')` without changes during tests.

module.exports = {
  process(src) {
    return { code: 'module.exports = ' + JSON.stringify(src) + ';' };
  },
  // No deps to invalidate cache against beyond src changes.
  getCacheKey(src) {
    return require('node:crypto').createHash('md5').update(src).digest('hex');
  },
};
