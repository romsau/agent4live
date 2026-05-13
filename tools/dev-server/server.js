'use strict';

// Dev server for iterating on the M4L device UI in a regular browser.
// - Serves the same HTML that the device serves at /ui (by re-requiring
//   device/server/ui/state.js with cache-busting on each request, so edits
//   hot-reload).
// - Mocks /ui/state with named fixtures (see fixtures.js) so we can preview
//   edge cases (no agents, restart pending, log saturated, errors-only…).
// - Wraps the device UI in a 360×170 viewport centered on the page.
// - Pushes SSE events so the wrapper auto-refreshes the iframe on file edits.
//
// Runs in plain Node.js — NOT Node-for-Max. Has nothing to do with the
// production runtime ; it's a tooling aid that lives next to the production
// code so the production sources stay the single source of truth.

const http = require('http');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const PORT = 19846;
const HERE = __dirname;
// HERE = repo/tools/dev-server/ → walk up twice to reach repo, then app/server.
const SRC_SERVER = path.join(HERE, '..', '..', 'app', 'server');
const UI_STATE = path.join(SRC_SERVER, 'ui', 'state.js');
const UI_ACTIVE = path.join(SRC_SERVER, 'ui', 'active.html');
const UI_PASSIVE = path.join(SRC_SERVER, 'ui', 'passive.html');
const FIXTURES = path.join(HERE, 'fixtures.js');
const WRAPPER = path.join(HERE, 'wrapper.html');

/* istanbul ignore next -- module-loader monkey-patching: Jest sandboxes
   require.extensions and Module.prototype.require, so this code is
   unreachable in unit tests. Exercised end-to-end via `npm run dev:ui`. */
/**
 * Install the .html require hook + max-api stub. Both are mutations of the
 * Node module loader — guard with a flag so re-imports during tests stay idempotent.
 */
function installModuleHooks() {
  if (!installModuleHooks.installed) {
    require.extensions['.html'] = function (mod, filename) {
      mod.exports = fs.readFileSync(filename, 'utf8');
    };
    require.extensions['.md'] = function (mod, filename) {
      mod.exports = fs.readFileSync(filename, 'utf8');
    };
    const maxApiStub = {
      post: () => {},
      outlet: () => Promise.resolve(),
      addHandler: () => {},
    };
    const origRequire = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (id === 'max-api') return maxApiStub;
      return origRequire.apply(this, arguments);
    };
    installModuleHooks.installed = true;
  }
}

/**
 * `require()` a module while busting its cache (and any cached `.html`) so
 * edits to UI sources show up on the next request without restarting the
 * dev server.
 *
 * @param {string} modPath
 * @returns {unknown}
 */
function freshRequire(modPath) {
  delete require.cache[require.resolve(modPath)];
  // Also bust any cached .html so edits to active.html show up on next /ui hit.
  for (const key of Object.keys(require.cache)) {
    if (key.endsWith('.html')) delete require.cache[key];
  }
  return require(modPath);
}

/** @returns {string} Current contents of wrapper.html. */
function readWrapper() {
  return fs.readFileSync(WRAPPER, 'utf8');
}

/**
 * Build the broadcast helper bound to a Set of SSE clients. Returns
 * `{ broadcast, sseClients }`.
 *
 * @returns {{ broadcast: (event: string, data?: object) => void, sseClients: Set }}
 */
function makeBroadcaster() {
  const sseClients = new Set();
  /**
   * Push an SSE event to every connected client. Disconnected clients silently
   * drop their writes.
   *
   * @param {string} event - SSE event name (e.g. 'reload', 'full-reload').
   * @param {object} [data]
   */
  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch (_) {}
    }
  }
  return { broadcast, sseClients };
}

/**
 * Watch a single file and debounce its change events to a single fn() call
 * — fs.watch fires twice on some platforms when an editor saves.
 *
 * @param {string} file
 * @param {() => void} fn
 * @returns {fs.FSWatcher}
 */
function watchDebounced(file, fn) {
  let timer = null;
  return fs.watch(file, { persistent: false }, () => {
    clearTimeout(timer);
    timer = setTimeout(fn, 100);
  });
}

/**
 * Build the HTTP request handler. Closes over a mutable state object so
 * file-watch callbacks can refresh `wrapperHtml`, `fixtures`, `activeFixture`.
 *
 * @param {object} state - { wrapperHtml, fixtures, activeFixture, sseClients }
 * @param {(event: string, payload: object) => void} broadcast - Emits an SSE event to every connected client.
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse) => void}
 */
function makeHandler(state, broadcast) {
  return (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = url.pathname;

    if (route === '/' || route === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(state.wrapperHtml);
      return;
    }

    if (route === '/ui') {
      const fixture = state.fixtures[state.activeFixture] || state.fixtures.default;
      const { buildUiHtml, buildPassiveUiHtml } = freshRequire(UI_STATE);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (fixture.mode === 'passive') {
        const trackName = fixture.activePeer ? fixture.activePeer.trackName : null;
        res.end(buildPassiveUiHtml(trackName));
      } else {
        res.end(buildUiHtml());
      }
      return;
    }

    if (route === '/ui/state') {
      const fixture = state.fixtures[state.activeFixture] || state.fixtures.default;
      // Inject the real package.json version so the UI footer shows it in
      // dev — fixtures themselves don't carry version (would be dead drift).
      const { version } = freshRequire(path.join(HERE, '..', '..', 'package.json'));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ ...fixture, version }));
      return;
    }

    if (route === '/dev/fixtures') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ active: state.activeFixture, names: Object.keys(state.fixtures) }));
      return;
    }

    // Mock the extension endpoints so Modal A "Install" and Modal B
    // "Recheck" buttons produce a deterministic, JSON-shaped response in the
    // dev preview — otherwise the fetch falls through to the 404 handler and
    // the client can't tell apart a real failure from an unmocked route.
    if (route === '/extension/recheck' && req.method === 'POST') {
      const fixture = state.fixtures[state.activeFixture] || state.fixtures.default;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: fixture.extensionStatus }));
      return;
    }
    if (route === '/extension/install' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: { scriptInstalled: true, pingOk: false } }));
      return;
    }

    if (route === '/detect' && req.method === 'POST') {
      // Dev preview only: simulate "agent got installed since startup" by
      // jumping the active fixture from `startup` → `default` so the click
      // produces a visible state change.
      if (state.activeFixture === 'startup') state.activeFixture = 'default';
      broadcast('reload');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (route.startsWith('/dev/fixture/')) {
      const name = decodeURIComponent(route.slice('/dev/fixture/'.length));
      if (state.fixtures[name]) {
        state.activeFixture = name;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('unknown fixture: ' + name);
      }
      return;
    }

    if (route === '/dev/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      state.sseClients.add(res);
      req.on('close', () => state.sseClients.delete(res));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  };
}

/**
 * Boot: install hooks, set up watches, create the HTTP server, listen.
 * Returns the http.Server for tests / programmatic shutdown.
 *
 * @returns {http.Server}
 */
function start() {
  installModuleHooks();
  const { broadcast, sseClients } = makeBroadcaster();
  const state = {
    wrapperHtml: readWrapper(),
    fixtures: require(FIXTURES),
    activeFixture: 'default',
    sseClients,
  };

  watchDebounced(UI_STATE, () => {
    console.log('[dev] server/ui/state.js changed → reloading iframe');
    broadcast('reload');
  });
  watchDebounced(UI_ACTIVE, () => {
    console.log('[dev] server/ui/active.html changed → reloading iframe');
    broadcast('reload');
  });
  watchDebounced(UI_PASSIVE, () => {
    console.log('[dev] server/ui/passive.html changed → reloading iframe');
    broadcast('reload');
  });
  watchDebounced(WRAPPER, () => {
    state.wrapperHtml = readWrapper();
    console.log('[dev] wrapper.html changed → full reload');
    broadcast('full-reload');
  });
  watchDebounced(FIXTURES, () => {
    state.fixtures = freshRequire(FIXTURES);
    /* istanbul ignore if -- auto-recovery branch: triggers only if the user
       removes their currently-active fixture from fixtures.js while the dev
       server is running. Manual edge case, not worth a test fixture. */
    if (!state.fixtures[state.activeFixture]) state.activeFixture = 'default';
    console.log(
      '[dev] fixtures.js changed → reloading iframe (active=' + state.activeFixture + ')',
    );
    broadcast('reload');
  });

  const server = http.createServer(makeHandler(state, broadcast));
  server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  agent4live UI dev server');
    console.log('  → http://127.0.0.1:' + PORT + '/');
    console.log('');
    console.log('  Editing device/server/ui/{state.js,active.html,passive.html} hot-reloads.');
    console.log('  Editing dev-server/{wrapper.html,fixtures.js} also live-reloads.');
    console.log('');
  });
  return server;
}

/* istanbul ignore if -- CLI entry guard, exercised end-to-end via
   `npm run dev:ui`. Sub-process coverage isn't propagated back. */
if (require.main === module) {
  start();
}

module.exports = {
  installModuleHooks,
  freshRequire,
  readWrapper,
  makeBroadcaster,
  watchDebounced,
  makeHandler,
  start,
  PORT,
};
