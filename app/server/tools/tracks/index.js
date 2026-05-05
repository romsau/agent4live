'use strict';

// AUTO-AUTHORED — orchestrates the per-section register() calls so a
// single tools/tracks require still works (`tools/index.js` doesn't
// have to know about the split).

const mixer_lifecycle = require('./mixer_lifecycle');
const routing = require('./routing');
const devices = require('./devices');
const take_lanes = require('./take_lanes');
const view = require('./view');
const groups = require('./groups');
const crossfader = require('./crossfader');
const master = require('./master');
const returns = require('./returns');
const device_io = require('./device_io');
const devices_params = require('./devices_params');

/**
 * Register every tracks-related tool on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  mixer_lifecycle.register(server);
  routing.register(server);
  devices.register(server);
  take_lanes.register(server);
  view.register(server);
  groups.register(server);
  crossfader.register(server);
  master.register(server);
  returns.register(server);
  device_io.register(server);
  devices_params.register(server);
}

module.exports = { register };
