'use strict';

// AUTO-AUTHORED — orchestrates the per-section register() calls so a
// single tools/clips require still works (`tools/index.js` doesn't
// have to know about the split).

const creation = require('./creation');
const notes = require('./notes');
const audio = require('./audio');
const launch = require('./launch');
const navigation = require('./navigation');
const extras = require('./extras');

/**
 * Register every clips-related tool on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  creation.register(server);
  notes.register(server);
  audio.register(server);
  launch.register(server);
  navigation.register(server);
  extras.register(server);
}

module.exports = { register };
