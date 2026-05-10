'use strict';

// Tool registrars grouped by family. Each module exports `register(server)`
// which calls server.tool(...) for every tool in its family.
//
// To add a new family: create <family>.js with a register() function,
// add it here, and call it from mcp/server.js#registerTools.

module.exports = {
  raw: require('./raw'),
  session: require('./session'),
  transport: require('./transport'),
  tracks: require('./tracks'),
  clips: require('./clips'),
  scenes: require('./scenes'),
  arrangement: require('./arrangement'),
  application: require('./application'),
  racks: require('./racks'),
  instruments: require('./instruments'),
  browser: require('./browser'),
  tuning: require('./tuning'),
  midi: require('./midi'),
  meta: require('./meta'),
};
