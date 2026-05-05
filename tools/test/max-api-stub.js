'use strict';

// Mock for the `max-api` module — only used at runtime inside Node-for-Max,
// can't be loaded in plain Node tests. Returns no-op implementations of
// every method state.js / sse.js touch.

module.exports = {
  post: () => {},
  outlet: () => Promise.resolve(),
  addHandler: () => {},
};
