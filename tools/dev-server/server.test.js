'use strict';

const path = require('path');
const fs = require('fs');

// We don't mock fs at module level: server.js does file IO at boot we want
// to exercise (readWrapper). For watch we override fs.watch ad-hoc per test.

const {
  freshRequire,
  readWrapper,
  makeBroadcaster,
  watchDebounced,
  makeHandler,
  installModuleHooks,
} = require('./server');

describe('readWrapper', () => {
  it('returns the contents of dev-server/wrapper.html', () => {
    const html = readWrapper();
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });
});

describe('makeBroadcaster', () => {
  it('writes the same SSE payload to every client; swallows write errors', () => {
    const { broadcast, sseClients } = makeBroadcaster();
    const writes = [];
    sseClients.add({ write: (p) => writes.push(p) });
    sseClients.add({
      write: () => {
        throw new Error('client gone');
      },
    });
    broadcast('reload', { foo: 1 });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('event: reload');
    expect(writes[0]).toContain('"foo":1');
  });

  it('uses an empty object payload when data is omitted', () => {
    const { broadcast, sseClients } = makeBroadcaster();
    const writes = [];
    sseClients.add({ write: (p) => writes.push(p) });
    broadcast('ping');
    expect(writes[0]).toContain('data: {}');
  });
});

describe('watchDebounced', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the watcher and invokes fn 100ms after last fs change', () => {
    let cb;
    const fakeWatcher = { close: jest.fn() };
    jest.spyOn(fs, 'watch').mockImplementation((file, opts, listener) => {
      cb = listener;
      return fakeWatcher;
    });
    const fn = jest.fn();
    const watcher = watchDebounced('whatever', fn);
    expect(watcher).toBe(fakeWatcher);

    cb('change', 'whatever');
    cb('change', 'whatever');
    cb('change', 'whatever');
    jest.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);

    fs.watch.mockRestore();
  });
});

describe('freshRequire', () => {
  it('returns the loaded module after busting Node require.cache', () => {
    // Use the local fixtures module as a guinea pig. Jest has its own runtime
    // module cache, so we can't observe a "different reference" here ; we
    // assert the function returns equal content + exercises the cache-bust paths.
    const fxPath = path.resolve(__dirname, 'fixtures.js');
    const a = require(fxPath);
    const b = freshRequire(fxPath);
    expect(b).toEqual(a);
  });

  it('purges cached .html entries from require.cache', () => {
    // Inject a synthetic .html cache entry then verify freshRequire deletes it.
    const fakeKey = '/synthetic/fake.html';
    require.cache[fakeKey] = { exports: 'fake' };
    freshRequire(path.resolve(__dirname, 'fixtures.js'));
    expect(require.cache[fakeKey]).toBeUndefined();
  });
});

describe('installModuleHooks', () => {
  it('is idempotent on re-invocation', () => {
    expect(() => installModuleHooks()).not.toThrow();
    expect(() => installModuleHooks()).not.toThrow();
  });
});

describe('makeHandler', () => {
  /**
   * Build a state object + broadcast spy + handler. Returns helpers + the
   * mutable state so tests can assert mutations.
   * @param root0
   * @param root0.fixtures
   * @param root0.activeFixture
   * @param root0.wrapperHtml
   */
  function setup({ fixtures = {}, activeFixture = 'default', wrapperHtml = '<html/>' } = {}) {
    const broadcast = jest.fn();
    const sseClients = new Set();
    const state = { fixtures, activeFixture, wrapperHtml, sseClients };
    const handler = makeHandler(state, broadcast);
    return { handler, broadcast, state, sseClients };
  }

  function reqres(url, method = 'GET') {
    const req = { url, method, headers: { host: '127.0.0.1:19846' }, on: jest.fn() };
    const res = {
      headers: null,
      chunks: [],
      ended: false,
      writeHead: jest.fn(function (status, headers) {
        this.statusCode = status;
        this.headers = headers;
      }),
      write: jest.fn(function (chunk) {
        this.chunks.push(chunk);
      }),
      end: jest.fn(function (body) {
        if (body !== undefined) this.chunks.push(body);
        this.ended = true;
      }),
    };
    return { req, res };
  }

  it('/ → wrapperHtml', () => {
    const { handler } = setup({ wrapperHtml: '<wrapper/>' });
    const { req, res } = reqres('/');
    handler(req, res);
    expect(res.chunks[0]).toBe('<wrapper/>');
  });

  it('/index.html → wrapperHtml', () => {
    const { handler } = setup({ wrapperHtml: '<wrapper/>' });
    const { req, res } = reqres('/index.html');
    handler(req, res);
    expect(res.chunks[0]).toBe('<wrapper/>');
  });

  it('/ui (active fixture) → buildUiHtml', () => {
    const { handler } = setup({
      fixtures: { default: { mode: 'active' } },
    });
    const { req, res } = reqres('/ui');
    handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(typeof res.chunks[0]).toBe('string');
    expect(res.chunks[0].length).toBeGreaterThan(0);
  });

  it('/ui falls back to default fixture when activeFixture is missing', () => {
    const { handler } = setup({
      fixtures: { default: { mode: 'active' } },
      activeFixture: 'nonexistent',
    });
    const { req, res } = reqres('/ui');
    handler(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('/ui (passive with activePeer) → buildPassiveUiHtml(trackName)', () => {
    const { handler } = setup({
      fixtures: {
        default: { mode: 'active' },
        psv: { mode: 'passive', activePeer: { trackName: 'Track A' } },
      },
      activeFixture: 'psv',
    });
    const { req, res } = reqres('/ui');
    handler(req, res);
    expect(res.chunks[0]).toContain('Track A');
  });

  it('/ui (passive with no activePeer) → buildPassiveUiHtml(null)', () => {
    const { handler } = setup({
      fixtures: {
        default: { mode: 'active' },
        psv: { mode: 'passive', activePeer: null },
      },
      activeFixture: 'psv',
    });
    const { req, res } = reqres('/ui');
    handler(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('/ui/state → fixture JSON augmented with package.json version', () => {
    const { handler } = setup({
      fixtures: { default: { connected: true } },
    });
    const { req, res } = reqres('/ui/state');
    handler(req, res);
    const body = JSON.parse(res.chunks[0]);
    expect(body.connected).toBe(true);
    // Version comes from package.json — match the semver shape rather than
    // hardcoding a specific value so the test stays green across bumps.
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('/ui/state falls back to default fixture when activeFixture missing', () => {
    const { handler } = setup({
      fixtures: { default: { x: 1 } },
      activeFixture: 'gone',
    });
    const { req, res } = reqres('/ui/state');
    handler(req, res);
    const body = JSON.parse(res.chunks[0]);
    expect(body.x).toBe(1);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('/dev/fixtures → list', () => {
    const { handler } = setup({
      fixtures: { default: {}, alt: {} },
      activeFixture: 'alt',
    });
    const { req, res } = reqres('/dev/fixtures');
    handler(req, res);
    expect(JSON.parse(res.chunks[0])).toEqual({ active: 'alt', names: ['default', 'alt'] });
  });

  it('/extension/recheck POST → echoes the active fixture extensionStatus', () => {
    const fixture = {
      mode: 'active',
      extensionStatus: { scriptInstalled: true, pingOk: false },
    };
    const { handler } = setup({ fixtures: { default: fixture } });
    const { req, res } = reqres('/extension/recheck', 'POST');
    handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.chunks[0])).toEqual({
      ok: true,
      status: { scriptInstalled: true, pingOk: false },
    });
  });

  it('/extension/recheck falls back to default fixture when activeFixture missing', () => {
    const fixture = {
      mode: 'active',
      extensionStatus: { scriptInstalled: false, pingOk: false },
    };
    const { handler } = setup({
      fixtures: { default: fixture },
      activeFixture: 'nonexistent',
    });
    const { req, res } = reqres('/extension/recheck', 'POST');
    handler(req, res);
    expect(JSON.parse(res.chunks[0]).status).toEqual({ scriptInstalled: false, pingOk: false });
  });

  it('/extension/install POST → ok with scriptInstalled=true, pingOk=false', () => {
    const { handler } = setup();
    const { req, res } = reqres('/extension/install', 'POST');
    handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.chunks[0])).toEqual({
      ok: true,
      status: { scriptInstalled: true, pingOk: false },
    });
  });

  it('/detect POST flips startup → default and broadcasts reload', () => {
    const { handler, broadcast, state } = setup({
      fixtures: { default: {}, startup: {} },
      activeFixture: 'startup',
    });
    const { req, res } = reqres('/detect', 'POST');
    handler(req, res);
    expect(state.activeFixture).toBe('default');
    expect(broadcast).toHaveBeenCalledWith('reload');
    expect(JSON.parse(res.chunks[0])).toEqual({ ok: true });
  });

  it('/detect POST when not in startup keeps activeFixture (still broadcasts)', () => {
    const { handler, broadcast, state } = setup({
      fixtures: { default: {}, alt: {} },
      activeFixture: 'alt',
    });
    const { req, res } = reqres('/detect', 'POST');
    handler(req, res);
    expect(state.activeFixture).toBe('alt');
    expect(broadcast).toHaveBeenCalledWith('reload');
  });

  it('/detect with non-POST → 404', () => {
    const { handler } = setup();
    const { req, res } = reqres('/detect', 'GET');
    handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it('/dev/fixture/<name> → switches activeFixture', () => {
    const { handler, state } = setup({ fixtures: { default: {}, alt: {} } });
    const { req, res } = reqres('/dev/fixture/alt');
    handler(req, res);
    expect(state.activeFixture).toBe('alt');
    expect(res.chunks[0]).toBe('ok');
  });

  it('/dev/fixture/<unknown> → 404 with name', () => {
    const { handler } = setup({ fixtures: { default: {} } });
    const { req, res } = reqres('/dev/fixture/missing');
    handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.chunks[0]).toContain('missing');
  });

  it('/dev/events → SSE headers + adds res to sseClients; close removes it', () => {
    const { handler, sseClients } = setup();
    const { req, res } = reqres('/dev/events');
    handler(req, res);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(sseClients.has(res)).toBe(true);
    // Trigger the close listener to verify cleanup.
    const closeCb = req.on.mock.calls.find((c) => c[0] === 'close')[1];
    closeCb();
    expect(sseClients.has(res)).toBe(false);
  });

  it('unknown route → 404', () => {
    const { handler } = setup();
    const { req, res } = reqres('/no/such/path');
    handler(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('start (smoke)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('boots, listens, and each watch listener fires its callback after debounce', () => {
    const { start, PORT } = require('./server');
    const watchListeners = [];
    const watchSpy = jest.spyOn(fs, 'watch').mockImplementation((_file, _opts, cb) => {
      watchListeners.push(cb);
      return { close: jest.fn() };
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const httpModule = require('http');
    const listenSpy = jest
      .spyOn(httpModule.Server.prototype, 'listen')
      .mockImplementation(function (_port, _host, cb) {
        if (cb) cb();
        return this;
      });

    try {
      const server = start();
      expect(server).toBeDefined();
      expect(listenSpy).toHaveBeenCalledWith(PORT, '127.0.0.1', expect.any(Function));

      // Five watchers were registered (state.js, active.html, passive.html,
      // wrapper.html, fixtures.js). Trigger each so its log+broadcast runs.
      expect(watchListeners).toHaveLength(5);
      for (const cb of watchListeners) cb('change', 'whatever');
      jest.advanceTimersByTime(100);

      // Verify the wrapper-changed callback rebuilt wrapperHtml (logs the line).
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('wrapper.html changed'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('state.js changed'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('fixtures.js changed'));
    } finally {
      listenSpy.mockRestore();
      logSpy.mockRestore();
      watchSpy.mockRestore();
    }
  });
});
