#!/usr/bin/env node
'use strict';

// Watch app/lom_router/ and regenerate app/lom_router.js on every save. Run
// this while iterating on the LOM router code so Max [js] (which watches
// app/lom_router.js via @autowatch 1) hot-reloads each edit.
//
// Usage:  npm run dev:lom   (or)   node tools/build/watch-lom.js
//
// Stops with Ctrl-C. Pure fs.watch, no external deps.

const fs = require('fs');
const path = require('path');
const { concat } = require('./concat-lom');

const SRC_DIR = path.join(__dirname, '..', '..', 'app', 'lom_router');

// fs.watch fires multiple events for a single editor save (rename + change on
// some editors). Debounce to a single concat call per logical save.
let timer = null;
/**
 * Debounce a concat run after a save. fs.watch fires twice on some editors
 * (rename + change) — the 100ms timer collapses both into a single concat.
 *
 * @param {string} reason - Filename that triggered the run, for the log line.
 */
function schedule(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      concat();
      console.log(`[dev:lom] ${reason} → regenerated app/lom_router.js`);
    } catch (err) {
      console.error('[dev:lom] concat failed:', err.message);
    }
  }, 100);
}

/**
 * Initial concat + start watching app/lom_router/ for changes. Returns the
 * fs.watcher so callers (tests) can close it.
 *
 * @returns {fs.FSWatcher}
 */
function start() {
  concat();
  console.log('[dev:lom] initial app/lom_router.js generated');

  const watcher = fs.watch(SRC_DIR, { persistent: true }, (_event, filename) => {
    if (!filename || !filename.endsWith('.js')) return;
    schedule(filename);
  });

  console.log('[dev:lom] watching ' + SRC_DIR);
  console.log('[dev:lom] save any *.js in app/lom_router/ to regenerate.');
  return watcher;
}

/* istanbul ignore if -- CLI entry guard, exercised end-to-end via
   `npm run dev:lom`. Sub-process coverage isn't propagated back. */
if (require.main === module) {
  start();
}

module.exports = { schedule, start };
