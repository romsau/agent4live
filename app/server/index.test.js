'use strict';

// app/server/index.js is the device's boot script: HTTP listen + active/passive
// mode lifecycle. It performs side effects at top-level (createServer, listen,
// process.on), so we drive each scenario via jest.isolateModules with fresh
// mocks per test.

const EventEmitter = require('events');

/**
 * Build the universe of mocks required by ./index.js. Returns the mocks so
 * the test can read uiState mutations + assert calls.
 */
function setupMocks() {
  const fakeServer = new EventEmitter();
  fakeServer.listen = jest.fn();
  fakeServer.close = jest.fn((cb) => cb && cb());
  let createdHandler = null;

  const mocks = {
    http: {
      createServer: jest.fn((handler) => {
        createdHandler = handler;
        return fakeServer;
      }),
    },
    Max: { outlet: jest.fn(() => Promise.resolve()) },
    config: {
      PORT: 12345,
      PASSIVE_BOOT_DELAY_MS: 100,
      PASSIVE_TICK_MS: 250,
      ACTIVE_BOOT_DELAY_MS: 50,
      ACTIVE_LOM_PING_DELAY_MS: 75,
    },
    uiState: {
      mode: 'active',
      connected: false,
      token: null,
      activePeer: null,
      port: null,
      agents: {},
    },
    log: jest.fn(),
    uiRender: jest.fn(),
    buildUiHtml: jest.fn(() => '<html>active</html>'),
    buildPassiveUiHtml: jest.fn((track) => `<html>passive ${track}</html>`),
    emitLoadingUi: jest.fn(),
    detectAgents: jest.fn(),
    setupDiscovery: jest.fn(() => 'tok-1'),
    teardownDiscovery: jest.fn(() => Promise.resolve()),
    setupConsentedClients: jest.fn(() => Promise.resolve()),
    registerOne: jest.fn(() => Promise.resolve()),
    unregisterOne: jest.fn(() => Promise.resolve()),
    loadPreferences: jest.fn(() => null),
    savePreferences: jest.fn(),
    defaultPreferences: jest.fn(() => ({ version: 1, agents: {} })),
    markConsent: jest.fn((prefs, agent, consented, url) => {
      if (!prefs.agents) prefs.agents = {};
      prefs.agents[agent] = consented
        ? { consented: true, consented_at: 't', url_at_consent: url }
        : { consented: false };
      return prefs;
    }),
    isFirstBoot: jest.fn((p) => !p || !p.agents || Object.keys(p.agents).length === 0),
    migrateFromExistingConfigs: jest.fn(() => ({})),
    applyAutoRegisterEnv: jest.fn((prefs) => prefs),
    AGENTS: ['claudeCode', 'codex', 'gemini', 'opencode'],
    PREFERENCES_FILE: '/tmp/fake-preferences.json',
    fs: {
      unlinkSync: jest.fn(),
    },
    getCompanionStatus: jest.fn(() => Promise.resolve({ scriptInstalled: false, pingOk: false })),
    installCompanion: jest.fn(() => Promise.resolve({ ok: true })),
    lomGet: jest.fn(() => Promise.resolve('120')),
    lomScanPeers: jest.fn(() => Promise.resolve(JSON.stringify({ peers: [] }))),
    handleMCP: jest.fn(() => Promise.resolve()),
    fakeServer,
    getHandler: () => createdHandler,
  };
  return mocks;
}

/**
 * Apply the mocks to Jest's module registry, then return a function that
 * loads ./index fresh.
 * @param mocks
 */
function withMocks(mocks) {
  jest.doMock('http', () => mocks.http);
  jest.doMock('max-api', () => mocks.Max);
  jest.doMock('./config', () => mocks.config);
  jest.doMock('./ui/state', () => ({
    uiState: mocks.uiState,
    log: mocks.log,
    uiRender: mocks.uiRender,
    buildUiHtml: mocks.buildUiHtml,
    buildPassiveUiHtml: mocks.buildPassiveUiHtml,
    emitLoadingUi: mocks.emitLoadingUi,
  }));
  jest.doMock('./discovery', () => ({
    detectAgents: mocks.detectAgents,
    setupDiscovery: mocks.setupDiscovery,
    teardownDiscovery: mocks.teardownDiscovery,
    setupConsentedClients: mocks.setupConsentedClients,
    registerOne: mocks.registerOne,
    unregisterOne: mocks.unregisterOne,
  }));
  jest.doMock('./preferences', () => ({
    loadPreferences: mocks.loadPreferences,
    savePreferences: mocks.savePreferences,
    defaultPreferences: mocks.defaultPreferences,
    markConsent: mocks.markConsent,
    isFirstBoot: mocks.isFirstBoot,
    migrateFromExistingConfigs: mocks.migrateFromExistingConfigs,
    applyAutoRegisterEnv: mocks.applyAutoRegisterEnv,
    AGENTS: mocks.AGENTS,
    PREFERENCES_FILE: mocks.PREFERENCES_FILE,
  }));
  jest.doMock('fs', () => mocks.fs);
  jest.doMock('./companion', () => ({
    getCompanionStatus: mocks.getCompanionStatus,
    installCompanion: mocks.installCompanion,
  }));
  // The Python source is bundled by esbuild's text loader at runtime, the .pyc
  // by the binary loader. In tests we feed fake values — handlers pass them
  // straight to installCompanion.
  jest.doMock('../python_scripts/__init__.py', () => 'PY_SOURCE_FAKE', { virtual: true });
  jest.doMock(
    '../python_scripts/__init__.pyc',
    () => Buffer.from([0xa7, 0x0d, 0x0d, 0x0a, 0xde, 0xad]),
    { virtual: true },
  );
  jest.doMock('./lom', () => ({
    lomGet: mocks.lomGet,
    lomScanPeers: mocks.lomScanPeers,
  }));
  jest.doMock('./mcp/server', () => ({ handleMCP: mocks.handleMCP }));
}

/**
 * Make a minimal req/res pair for HTTP route testing. `body` (if provided)
 * is exposed as an async iterable of one chunk so handlers using
 * `for await (const c of req)` work transparently.
 * @param url
 * @param method
 * @param body
 */
function reqres(url, method = 'GET', body) {
  const req = { url, method };
  if (body !== undefined) {
    const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    req[Symbol.asyncIterator] = async function* () {
      yield buf;
    };
  } else {
    req[Symbol.asyncIterator] = async function* () {};
  }
  const res = {
    statusCode: null,
    headersSent: false,
    chunks: [],
    headers: null,
    writeHead: jest.fn(function (status, headers) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    }),
    end: jest.fn(function (body) {
      if (body !== undefined) this.chunks.push(body);
    }),
  };
  return { req, res };
}

let processListeners;
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  processListeners = { SIGTERM: [], SIGINT: [] };
  jest.spyOn(process, 'on').mockImplementation((evt, cb) => {
    if (evt === 'SIGTERM') processListeners.SIGTERM.push(cb);
    if (evt === 'SIGINT') processListeners.SIGINT.push(cb);
    return process;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('boot', () => {
  it('detects all agents, logs Node.js, builds the UI, calls listen', () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    expect(mocks.detectAgents).toHaveBeenCalled();
    expect(mocks.buildUiHtml).toHaveBeenCalled();
    expect(mocks.fakeServer.listen).toHaveBeenCalledWith(12345, '127.0.0.1', expect.any(Function));
  });

  it('pushes the Loading placeholder before anything else (overrides stale jweb cache)', () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    expect(mocks.emitLoadingUi).toHaveBeenCalled();
    // Loading must come before detectAgents (and therefore before any HTTP setup).
    expect(mocks.emitLoadingUi.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.detectAgents.mock.invocationCallOrder[0],
    );
  });

  it('listen success in active mode → activeBoot wires discovery + clients + LOM ping', async () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    // Trigger the listen callback (Node calls it once the socket binds).
    mocks.fakeServer.listen.mock.calls[0][2]();
    expect(mocks.setupDiscovery).toHaveBeenCalledWith(12345);
    expect(mocks.uiState.token).toBe('tok-1');
    expect(mocks.uiState.connected).toBe(true);
    expect(mocks.uiRender).toHaveBeenCalled();

    // Advance timers to fire setupConsentedClients and LOM ping.
    jest.advanceTimersByTime(50);
    expect(mocks.setupConsentedClients).toHaveBeenCalled();
    jest.advanceTimersByTime(75);
    expect(mocks.lomGet).toHaveBeenCalledWith('live_set', 'tempo');
  });

  it('activeBoot tolerates LOM ping failure (logs)', async () => {
    const mocks = setupMocks();
    mocks.lomGet.mockReturnValue(Promise.reject(new Error('LOM down')));
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    jest.advanceTimersByTime(75);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.log).toHaveBeenCalledWith(
      expect.stringContaining('Initial LOM ping failed: LOM down'),
    );
  });

  it('activeBoot leaves token null when setupDiscovery returns null', () => {
    const mocks = setupMocks();
    mocks.setupDiscovery.mockReturnValue(null);
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    expect(mocks.uiState.token).toBeNull();
  });

  it('bootstrapPreferences: existing prefs are passed through unchanged', () => {
    const mocks = setupMocks();
    const stored = { version: 1, agents: { claudeCode: { consented: true } } };
    mocks.loadPreferences.mockReturnValue(stored);
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    jest.advanceTimersByTime(50);
    expect(mocks.setupConsentedClients).toHaveBeenCalledWith(stored, expect.any(String), 'tok-1');
    expect(mocks.savePreferences).not.toHaveBeenCalled();
    expect(mocks.migrateFromExistingConfigs).not.toHaveBeenCalled();
  });

  it('bootstrapPreferences: first boot with migration → savePreferences + log', () => {
    const mocks = setupMocks();
    mocks.loadPreferences.mockReturnValue(null);
    mocks.migrateFromExistingConfigs.mockReturnValue({ claudeCode: true });
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    expect(mocks.savePreferences).toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.stringContaining('Preferences bootstrapped'));
    jest.advanceTimersByTime(50);
    const passedPrefs = mocks.setupConsentedClients.mock.calls[0][0];
    expect(passedPrefs.agents.claudeCode.consented).toBe(true);
  });

  it('bootstrapPreferences: first boot, nothing to migrate → null prefs (modal will trigger)', () => {
    const mocks = setupMocks();
    mocks.loadPreferences.mockReturnValue(null);
    mocks.migrateFromExistingConfigs.mockReturnValue({});
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    expect(mocks.savePreferences).not.toHaveBeenCalled();
    jest.advanceTimersByTime(50);
    expect(mocks.setupConsentedClients).toHaveBeenCalledWith(null, expect.any(String), 'tok-1');
  });

  it('bootstrapPreferences: skips migrated entries with falsy value (defensive)', () => {
    const mocks = setupMocks();
    mocks.loadPreferences.mockReturnValue(null);
    mocks.migrateFromExistingConfigs.mockReturnValue({ claudeCode: false, opencode: true });
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    expect(mocks.markConsent).toHaveBeenCalledWith(
      expect.anything(),
      'opencode',
      true,
      expect.any(String),
    );
    expect(mocks.markConsent).not.toHaveBeenCalledWith(
      expect.anything(),
      'claudeCode',
      expect.anything(),
      expect.anything(),
    );
  });

  it('bootstrapPreferences: applyAutoRegisterEnv contributes consent → save + persist', () => {
    const mocks = setupMocks();
    mocks.loadPreferences.mockReturnValue(null);
    mocks.migrateFromExistingConfigs.mockReturnValue({});
    mocks.applyAutoRegisterEnv.mockImplementation((prefs) => {
      prefs.agents = prefs.agents || {};
      prefs.agents.codex = { consented: true };
      return prefs;
    });
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    expect(mocks.savePreferences).toHaveBeenCalled();
  });
});

describe('HTTP routes', () => {
  function bootAndGetHandler() {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    return { mocks, handler: mocks.getHandler() };
  }

  it('/mcp delegates to handleMCP', async () => {
    const { mocks, handler } = bootAndGetHandler();
    const { req, res } = reqres('/mcp', 'POST');
    handler(req, res);
    expect(mocks.handleMCP).toHaveBeenCalledWith(req, res);
  });

  it('/mcp catches handleMCP rejection — writes 500 if headers not sent', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.handleMCP.mockReturnValue(Promise.reject(new Error('boom')));
    const { req, res } = reqres('/mcp', 'POST');
    handler(req, res);
    await Promise.resolve();
    await Promise.resolve();
    expect(res.statusCode).toBe(500);
    expect(mocks.log).toHaveBeenCalledWith('Request error: boom');
  });

  it('/mcp catches handleMCP rejection — leaves response alone if headers sent', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.handleMCP.mockReturnValue(Promise.reject(new Error('mid-stream')));
    const { req, res } = reqres('/mcp', 'POST');
    res.headersSent = true;
    handler(req, res);
    await Promise.resolve();
    await Promise.resolve();
    expect(res.statusCode).toBeNull();
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it('/ui returns HTML', () => {
    const { handler } = bootAndGetHandler();
    const { req, res } = reqres('/ui');
    handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.chunks[0]).toBe('<html>active</html>');
  });

  it('/ui/state strips token, enriches agents with consent + firstBoot', () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.uiState.token = 'secret';
    mocks.uiState.agents = {
      claudeCode: { detected: true, registered: false },
      codex: { detected: false, registered: false },
      gemini: { detected: false, registered: false },
      opencode: { detected: false, registered: false },
    };
    mocks.loadPreferences.mockReturnValue({
      agents: { claudeCode: { consented: true } },
    });
    const { req, res } = reqres('/ui/state');
    handler(req, res);
    const body = JSON.parse(res.chunks[0]);
    expect(body.token).toBeUndefined();
    expect(body.agents.claudeCode.consented).toBe(true);
    expect(body.agents.codex.consented).toBe(false);
    expect(body.firstBoot).toBe(false);
  });

  it('/ui/state surfaces firstBoot=true when no preferences exist', () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.uiState.agents = {
      claudeCode: { detected: true, registered: false },
      codex: { detected: false, registered: false },
      gemini: { detected: false, registered: false },
      opencode: { detected: false, registered: false },
    };
    mocks.loadPreferences.mockReturnValue(null);
    const { req, res } = reqres('/ui/state');
    handler(req, res);
    const body = JSON.parse(res.chunks[0]);
    expect(body.firstBoot).toBe(true);
    for (const k of ['claudeCode', 'codex', 'gemini', 'opencode']) {
      expect(body.agents[k].consented).toBe(false);
    }
  });

  it('/detect POST runs detect + discovery + clients, returns ok', () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.detectAgents.mockClear();
    mocks.setupDiscovery.mockClear();
    mocks.setupConsentedClients.mockClear();
    const { req, res } = reqres('/detect', 'POST');
    handler(req, res);
    expect(mocks.detectAgents).toHaveBeenCalled();
    expect(mocks.setupDiscovery).toHaveBeenCalledWith(12345);
    expect(mocks.setupConsentedClients).toHaveBeenCalled();
    expect(JSON.parse(res.chunks[0])).toEqual({ ok: true });
  });

  it('/detect POST keeps existing token when setupDiscovery returns null', () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.uiState.token = 'pre-existing';
    mocks.setupDiscovery.mockReturnValue(null);
    const { req, res } = reqres('/detect', 'POST');
    handler(req, res);
    expect(mocks.uiState.token).toBe('pre-existing');
  });

  it('/detect with non-POST falls through to 404', () => {
    const { handler } = bootAndGetHandler();
    const { req, res } = reqres('/detect', 'GET');
    handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it('unknown path → 404', () => {
    const { handler } = bootAndGetHandler();
    const { req, res } = reqres('/unknown');
    handler(req, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('Preferences endpoints', () => {
  function bootAndGetHandler() {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    return { mocks, handler: mocks.getHandler() };
  }

  /**
   * Drain microtasks so the async route handlers' chains (readJsonBody +
   * applyConsent loop + savePreferences) settle before we inspect res.
   */
  async function flush() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }

  it('GET /preferences returns defaults when no preferences file', async () => {
    const { mocks, handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences', 'GET');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.chunks[0])).toEqual({ version: 1, agents: {} });
    expect(mocks.defaultPreferences).toHaveBeenCalled();
  });

  it('GET /preferences returns current state when prefs exist', async () => {
    const mocks = setupMocks();
    const stored = { version: 1, agents: { claudeCode: { consented: true } } };
    mocks.loadPreferences.mockReturnValue(stored);
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    const handler = mocks.getHandler();
    const { req, res } = reqres('/preferences', 'GET');
    handler(req, res);
    await flush();
    expect(JSON.parse(res.chunks[0])).toEqual(stored);
  });

  it('POST /preferences batch: registers consented, unregisters revoked, saves', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.uiState.token = 'tok';
    const { req, res } = reqres('/preferences', 'POST', {
      claudeCode: true,
      codex: false,
    });
    handler(req, res);
    await flush();
    expect(mocks.registerOne).toHaveBeenCalledWith(
      'claudeCode',
      expect.stringContaining('/mcp'),
      'tok',
    );
    expect(mocks.unregisterOne).toHaveBeenCalledWith('codex');
    expect(mocks.savePreferences).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('POST /preferences ignores keys not in AGENTS', async () => {
    const { mocks, handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences', 'POST', { evil: true, hacker: false });
    handler(req, res);
    await flush();
    expect(mocks.registerOne).not.toHaveBeenCalled();
    expect(mocks.unregisterOne).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('POST /preferences ignores non-boolean values', async () => {
    const { mocks, handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences', 'POST', { claudeCode: 'yes please' });
    handler(req, res);
    await flush();
    expect(mocks.registerOne).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('POST /preferences with malformed JSON → 400', async () => {
    const { handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences', 'POST', '{not-json');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(400);
  });

  it('POST /preferences with empty body → 200 no-op (covers raw="" branch)', async () => {
    const { mocks, handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences', 'POST', '');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(200);
    expect(mocks.registerOne).not.toHaveBeenCalled();
  });

  it('POST /preferences/agent/:name with unknown agent → 404', async () => {
    const { handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences/agent/evil', 'POST', { consented: true });
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(404);
  });

  it('POST /preferences/agent/claudeCode with consented:true → register', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.uiState.token = 'tok';
    const { req, res } = reqres('/preferences/agent/claudeCode', 'POST', { consented: true });
    handler(req, res);
    await flush();
    expect(mocks.registerOne).toHaveBeenCalledWith('claudeCode', expect.any(String), 'tok');
    expect(mocks.savePreferences).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('POST /preferences/agent/claudeCode with consented:false → unregister', async () => {
    const { mocks, handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences/agent/claudeCode', 'POST', { consented: false });
    handler(req, res);
    await flush();
    expect(mocks.unregisterOne).toHaveBeenCalledWith('claudeCode');
    expect(res.statusCode).toBe(200);
  });

  it('POST /preferences/agent without consented field → 400', async () => {
    const { handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences/agent/codex', 'POST', {});
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(400);
  });

  it('POST /preferences/agent with malformed JSON → 400 via outer catch', async () => {
    const { handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences/agent/codex', 'POST', '{not-json');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(400);
  });

  it('POST /preferences/reset unregisters every agent + deletes file', async () => {
    const { mocks, handler } = bootAndGetHandler();
    const { req, res } = reqres('/preferences/reset', 'POST');
    handler(req, res);
    await flush();
    expect(mocks.unregisterOne).toHaveBeenCalledWith('claudeCode');
    expect(mocks.unregisterOne).toHaveBeenCalledWith('codex');
    expect(mocks.unregisterOne).toHaveBeenCalledWith('gemini');
    expect(mocks.unregisterOne).toHaveBeenCalledWith('opencode');
    expect(mocks.fs.unlinkSync).toHaveBeenCalledWith('/tmp/fake-preferences.json');
    expect(res.statusCode).toBe(200);
  });

  it('POST /preferences/reset tolerates unregisterOne rejection per agent', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.unregisterOne.mockImplementation(() => Promise.reject(new Error('cli busted')));
    const { req, res } = reqres('/preferences/reset', 'POST');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(200);
  });

  it('POST /preferences/reset tolerates unlinkSync throwing (file already gone)', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.fs.unlinkSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const { req, res } = reqres('/preferences/reset', 'POST');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(200);
  });

  it('POST /preferences/reset surfaces JSON-build errors as 500', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.defaultPreferences.mockImplementation(() => {
      throw new Error('boom');
    });
    const { req, res } = reqres('/preferences/reset', 'POST');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(500);
  });
});

describe('Companion endpoints', () => {
  function bootAndGetHandler() {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    return { mocks, handler: mocks.getHandler() };
  }

  async function flush() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }

  it('POST /companion/install returns 200 + status when install ok', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.installCompanion.mockResolvedValue({ ok: true });
    mocks.getCompanionStatus.mockResolvedValue({ scriptInstalled: true, pingOk: false });
    const { req, res } = reqres('/companion/install', 'POST');
    handler(req, res);
    await flush();
    expect(mocks.installCompanion).toHaveBeenCalledWith('PY_SOURCE_FAKE', expect.any(Buffer));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.chunks[0]);
    expect(body.ok).toBe(true);
    expect(body.status).toEqual({ scriptInstalled: true, pingOk: false });
  });

  it('POST /companion/install returns 500 + error message when install fails', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.installCompanion.mockResolvedValue({
      ok: false,
      error: 'cannot create User Library Remote Scripts: EACCES',
    });
    const { req, res } = reqres('/companion/install', 'POST');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.chunks[0]);
    expect(body.error).toMatch(/EACCES/);
  });

  it('POST /companion/install surfaces a thrown error as 500', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.installCompanion.mockImplementation(() => Promise.reject(new Error('disk full')));
    const { req, res } = reqres('/companion/install', 'POST');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.chunks[0]).error).toBe('disk full');
  });

  it('POST /companion/recheck returns the current status', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.getCompanionStatus.mockResolvedValue({ scriptInstalled: true, pingOk: true });
    const { req, res } = reqres('/companion/recheck', 'POST');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.chunks[0]);
    expect(body).toEqual({ ok: true, status: { scriptInstalled: true, pingOk: true } });
  });

  it('POST /companion/recheck surfaces unexpected errors as 500', async () => {
    const { mocks, handler } = bootAndGetHandler();
    mocks.getCompanionStatus.mockImplementation(() => Promise.reject(new Error('oops')));
    const { req, res } = reqres('/companion/recheck', 'POST');
    handler(req, res);
    await flush();
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.chunks[0]).error).toBe('oops');
  });

  it('updateCompanionStatus is called at boot (best-effort, error is logged not thrown)', async () => {
    const mocks = setupMocks();
    mocks.getCompanionStatus.mockImplementation(() => Promise.reject(new Error('boot fail')));
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    await flush();
    expect(mocks.log).toHaveBeenCalledWith(expect.stringContaining('Companion check failed'));
  });
});

describe('passive mode lifecycle', () => {
  it('EADDRINUSE in active+disconnected → enterPassiveMode + passiveTick after delay', async () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    // Boot already triggered listen — stub a second listen call so passive
    // retry-bind doesn't blow up.
    mocks.fakeServer.listen.mockImplementation(() => {});

    mocks.fakeServer.emit('error', Object.assign(new Error('addr in use'), { code: 'EADDRINUSE' }));
    expect(mocks.uiState.mode).toBe('passive');

    // After PASSIVE_BOOT_DELAY_MS the first tick fires.
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.lomScanPeers).toHaveBeenCalled();
  });

  it('EADDRINUSE while already connected stays silent', () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();
    expect(mocks.uiState.connected).toBe(true);
    mocks.fakeServer.emit('error', Object.assign(new Error('addr in use'), { code: 'EADDRINUSE' }));
    expect(mocks.uiState.mode).toBe('active');
  });

  it('non-EADDRINUSE error is logged', () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.emit('error', Object.assign(new Error('socket boom'), { code: 'OTHER' }));
    expect(mocks.log).toHaveBeenCalledWith('Server error: socket boom');
  });

  it('passiveTick: lomScanPeers returns a non-self peer → emitPassiveUi via Max', async () => {
    const mocks = setupMocks();
    mocks.lomScanPeers.mockReturnValue(
      Promise.resolve(
        JSON.stringify({ peers: [{ isSelf: true }, { isSelf: false, trackName: 'Master' }] }),
      ),
    );
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mockImplementation(() => {});
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.Max.outlet).toHaveBeenCalledWith(
      'ui_status',
      'url',
      expect.stringMatching(/^data:text\/html;base64,/),
    );
    expect(mocks.uiState.activePeer).toEqual({ trackName: 'Master' });
  });

  it('passiveTick: same trackName twice → emit only once', async () => {
    const mocks = setupMocks();
    mocks.lomScanPeers.mockReturnValue(
      Promise.resolve(JSON.stringify({ peers: [{ isSelf: false, trackName: 'M' }] })),
    );
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mockImplementation(() => {});
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    mocks.Max.outlet.mockClear();
    jest.advanceTimersByTime(250); // PASSIVE_TICK_MS
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.Max.outlet).not.toHaveBeenCalled();
  });

  it('passiveTick: Max.outlet rejection is silently swallowed', async () => {
    const mocks = setupMocks();
    mocks.Max.outlet.mockReturnValue(Promise.reject(new Error('outlet down')));
    mocks.lomScanPeers.mockReturnValue(
      Promise.resolve(JSON.stringify({ peers: [{ isSelf: false, trackName: 'X' }] })),
    );
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mockImplementation(() => {});
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // No throw — the promise rejection was caught.
    expect(mocks.Max.outlet).toHaveBeenCalled();
  });

  it('passiveTick: lomScanPeers returns object without peers field → defaults to []', async () => {
    const mocks = setupMocks();
    mocks.lomScanPeers.mockReturnValue(Promise.resolve(JSON.stringify({})));
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mockImplementation(() => {});
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.uiState.activePeer).toBeNull();
  });

  it('passiveTick: lomScanPeers rejects → logs', async () => {
    const mocks = setupMocks();
    mocks.lomScanPeers.mockReturnValue(Promise.reject(new Error('scan died')));
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mockImplementation(() => {});
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.log).toHaveBeenCalledWith('Passive scan failed: scan died');
  });

  it('passiveTick: listen throws synchronously → swallowed', async () => {
    const mocks = setupMocks();
    let listenCallCount = 0;
    mocks.fakeServer.listen.mockImplementation(() => {
      listenCallCount++;
      if (listenCallCount > 1) {
        throw new Error('still busy');
      }
    });
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    expect(() => jest.advanceTimersByTime(100)).not.toThrow();
  });

  it('listen success while in passive → becomeActive (mode → active, ticker cleared)', async () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    // Capture listen callback and trigger it later.
    const successCb = mocks.fakeServer.listen.mock.calls[0][2];
    mocks.fakeServer.listen.mockImplementation(() => {});

    // Enter passive
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.uiState.mode).toBe('passive');

    // Now the port becomes free — listen succeeds.
    successCb();
    expect(mocks.uiState.mode).toBe('active');
    expect(mocks.uiState.activePeer).toBeNull();
    expect(mocks.log).toHaveBeenCalledWith('Acquired port — switching from passive to active');
  });

  it('enterPassiveMode is idempotent', () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mockImplementation(() => {});
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    const logCount = mocks.log.mock.calls.filter(
      (c) => c[0] === 'Port busy → entering passive mode',
    ).length;
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    const logCount2 = mocks.log.mock.calls.filter(
      (c) => c[0] === 'Port busy → entering passive mode',
    ).length;
    expect(logCount2).toBe(logCount);
  });
});

describe('shutdown via SIGTERM/SIGINT', () => {
  it('active shutdown: clears ticker, teardownDiscovery, close', async () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mock.calls[0][2]();

    const sigterm = processListeners.SIGTERM[0];
    await sigterm();
    expect(mocks.teardownDiscovery).toHaveBeenCalled();
    expect(mocks.fakeServer.close).toHaveBeenCalled();
    expect(mocks.uiState.connected).toBe(false);
    expect(mocks.log).toHaveBeenCalledWith('Server closed');
  });

  it('passive shutdown: skips teardownDiscovery', async () => {
    const mocks = setupMocks();
    withMocks(mocks);
    jest.isolateModules(() => require('./index'));
    mocks.fakeServer.listen.mockImplementation(() => {});
    mocks.fakeServer.emit('error', Object.assign(new Error('addr'), { code: 'EADDRINUSE' }));
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();

    mocks.teardownDiscovery.mockClear();
    const sigint = processListeners.SIGINT[0];
    await sigint();
    expect(mocks.teardownDiscovery).not.toHaveBeenCalled();
  });
});
