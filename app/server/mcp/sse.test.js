'use strict';

// Tests for sse.js — parseUri pure-logic + subscribe/unsubscribe ref-counting
// + onLomEvent fan-out. Mocks @modelcontextprotocol/sdk types (just needs
// the schema constants to be present), max-api (capture lom_event handler),
// and ../lom (mock lomObserve / lomUnobserve / lomGet).

const lomEventHandlers = {};
const Max = {
  addHandler: jest.fn((name, fn) => {
    lomEventHandlers[name] = fn;
  }),
  outlet: jest.fn(() => Promise.resolve()),
  post: jest.fn(),
};
jest.mock('max-api', () => Max);

jest.mock('../lom', () => ({
  lomGet: jest.fn(),
  lomObserve: jest.fn(),
  lomUnobserve: jest.fn(),
}));

jest.mock('../ui/state', () => ({
  log: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  SubscribeRequestSchema: { _tag: 'subscribe' },
  UnsubscribeRequestSchema: { _tag: 'unsubscribe' },
  ReadResourceRequestSchema: { _tag: 'read' },
  ListResourcesRequestSchema: { _tag: 'list' },
}));

const sse = require('./sse');
const {
  parseUri,
  subscribe,
  unsubscribe,
  releaseSession,
  onLomEvent,
  registerResourceHandlers,
  _state,
} = sse;
const lom = require('../lom');
const { DEFAULT_THROTTLE_MS } = require('../config');

beforeEach(() => {
  lom.lomObserve.mockReset();
  lom.lomUnobserve.mockReset();
  lom.lomGet.mockReset();
  _state.subs.clear();
  _state.observerToUri.clear();
  _state.sessionServers.clear();
});

describe('parseUri', () => {
  it('extracts path + prop from a basic URI', () => {
    const result = parseUri('live:///live_set?prop=tempo');
    expect(result.path).toBe('live_set');
    expect(result.prop).toBe('tempo');
    expect(result.throttle_ms).toBe(DEFAULT_THROTTLE_MS);
  });

  it('converts URI slashes to LOM spaces', () => {
    const result = parseUri('live:///live_set/tracks/0/mixer_device/volume?prop=value');
    expect(result.path).toBe('live_set tracks 0 mixer_device volume');
    expect(result.prop).toBe('value');
  });

  it('honors explicit throttle_ms', () => {
    const result = parseUri('live:///live_set?prop=tempo&throttle_ms=500');
    expect(result.throttle_ms).toBe(500);
  });

  it('clamps negative throttle_ms to 0', () => {
    const result = parseUri('live:///live_set?prop=tempo&throttle_ms=-100');
    expect(result.throttle_ms).toBe(0);
  });

  it('throws on a non-live:// scheme', () => {
    expect(() => parseUri('http://localhost/live_set?prop=tempo')).toThrow(/Invalid live:\/\/ URI/);
  });

  it('throws when ?prop= is missing', () => {
    expect(() => parseUri('live:///live_set')).toThrow(/URI missing required \?prop=/);
  });

  it('throws on totally malformed input', () => {
    expect(() => parseUri('not a uri at all')).toThrow(/Invalid live:\/\/ URI/);
  });

  it('tolerates the empty authority form (live:///path)', () => {
    const result = parseUri('live:///live_set/tracks/0?prop=mute');
    expect(result.path).toBe('live_set tracks 0');
    expect(result.prop).toBe('mute');
  });
});

describe('subscribe / unsubscribe', () => {
  it('starts an observer on first subscriber and bumps the session set on subsequent calls', async () => {
    lom.lomObserve.mockResolvedValueOnce(42);
    await subscribe('s1', 'live:///live_set?prop=tempo');
    expect(lom.lomObserve).toHaveBeenCalledWith('live_set', 'tempo', DEFAULT_THROTTLE_MS);
    // Second subscriber on same URI must NOT call lomObserve again.
    await subscribe('s2', 'live:///live_set?prop=tempo');
    expect(lom.lomObserve).toHaveBeenCalledTimes(1);
    const entry = _state.subs.get('live:///live_set?prop=tempo');
    expect(entry.sessions).toEqual(new Set(['s1', 's2']));
    expect(entry.observerId).toBe(42);
  });

  it('frees the observer when the last subscriber unsubscribes', async () => {
    lom.lomObserve.mockResolvedValueOnce(7);
    lom.lomUnobserve.mockResolvedValueOnce();
    await subscribe('s1', 'live:///live_set?prop=tempo');
    await unsubscribe('s1', 'live:///live_set?prop=tempo');
    expect(lom.lomUnobserve).toHaveBeenCalledWith(7);
    expect(_state.subs.has('live:///live_set?prop=tempo')).toBe(false);
    expect(_state.observerToUri.has(7)).toBe(false);
  });

  it('does not free the observer if other sessions remain', async () => {
    lom.lomObserve.mockResolvedValueOnce(8);
    await subscribe('s1', 'live:///live_set?prop=tempo');
    await subscribe('s2', 'live:///live_set?prop=tempo');
    await unsubscribe('s1', 'live:///live_set?prop=tempo');
    expect(lom.lomUnobserve).not.toHaveBeenCalled();
    expect(_state.subs.has('live:///live_set?prop=tempo')).toBe(true);
  });

  it('unsubscribe is a no-op for an unknown URI', async () => {
    await unsubscribe('s1', 'live:///nope?prop=x');
    expect(lom.lomUnobserve).not.toHaveBeenCalled();
  });

  it('logs but does not throw when lomUnobserve rejects', async () => {
    lom.lomObserve.mockResolvedValueOnce(9);
    lom.lomUnobserve.mockRejectedValueOnce(new Error('oh no'));
    await subscribe('s1', 'live:///live_set?prop=tempo');
    await expect(unsubscribe('s1', 'live:///live_set?prop=tempo')).resolves.toBeUndefined();
  });

  it('skips the lomUnobserve branch when observerId is null/undefined', async () => {
    // Manually plant an entry with null observerId — simulates a partial init.
    _state.subs.set('live:///live_set?prop=tempo', {
      sessions: new Set(['s1']),
      observerId: null,
      path: 'live_set',
      prop: 'tempo',
      throttle_ms: 100,
    });
    await unsubscribe('s1', 'live:///live_set?prop=tempo');
    expect(lom.lomUnobserve).not.toHaveBeenCalled();
    expect(_state.subs.has('live:///live_set?prop=tempo')).toBe(false);
  });
});

describe('releaseSession', () => {
  it('walks every URI the session subscribed to and unsubscribes', async () => {
    lom.lomObserve.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    lom.lomUnobserve.mockResolvedValue();
    await subscribe('s1', 'live:///live_set?prop=tempo');
    await subscribe('s1', 'live:///live_set?prop=is_playing');
    await releaseSession('s1');
    expect(lom.lomUnobserve).toHaveBeenCalledTimes(2);
    expect(_state.subs.size).toBe(0);
    expect(_state.sessionServers.has('s1')).toBe(false);
  });

  it('leaves URIs subscribed by other sessions intact', async () => {
    lom.lomObserve.mockResolvedValueOnce(3);
    await subscribe('s1', 'live:///live_set?prop=tempo');
    await subscribe('s2', 'live:///live_set?prop=tempo');
    await releaseSession('s1');
    expect(lom.lomUnobserve).not.toHaveBeenCalled();
    expect(_state.subs.size).toBe(1);
  });

  it('skips URIs the session never subscribed to (defensive against stale snapshots)', async () => {
    // s2 has a subscription, s1 does not. Releasing s1 should not touch s2's URI.
    lom.lomObserve.mockResolvedValueOnce(4);
    await subscribe('s2', 'live:///live_set?prop=tempo');
    await releaseSession('s1');
    expect(lom.lomUnobserve).not.toHaveBeenCalled();
    expect(_state.subs.size).toBe(1);
  });
});

describe('onLomEvent', () => {
  it('fans out resources/updated to every session subscribed to the URI', async () => {
    lom.lomObserve.mockResolvedValueOnce(11);
    const sendResourceUpdated = jest.fn(() => Promise.resolve());
    _state.sessionServers.set('s1', { sendResourceUpdated });
    _state.sessionServers.set('s2', { sendResourceUpdated });
    await subscribe('s1', 'live:///live_set?prop=tempo');
    await subscribe('s2', 'live:///live_set?prop=tempo');

    onLomEvent(11);
    expect(sendResourceUpdated).toHaveBeenCalledTimes(2);
    expect(sendResourceUpdated).toHaveBeenCalledWith({ uri: 'live:///live_set?prop=tempo' });
  });

  it('is a no-op for an unknown observerId', () => {
    expect(() => onLomEvent(9999)).not.toThrow();
  });

  it('is a no-op when the URI maps but its entry is gone (race)', () => {
    _state.observerToUri.set(33, 'live:///live_set?prop=tempo');
    // No entry in subs — should bail without crashing.
    expect(() => onLomEvent(33)).not.toThrow();
  });

  it('skips sessions whose server is no longer registered', async () => {
    lom.lomObserve.mockResolvedValueOnce(44);
    await subscribe('s1', 'live:///live_set?prop=tempo');
    // Don't register a server for s1 — the loop must skip it.
    expect(() => onLomEvent(44)).not.toThrow();
  });

  it('logs but does not throw when sendResourceUpdated rejects', async () => {
    lom.lomObserve.mockResolvedValueOnce(55);
    const sendResourceUpdated = jest.fn(() => Promise.reject(new Error('closed')));
    _state.sessionServers.set('s1', { sendResourceUpdated });
    await subscribe('s1', 'live:///live_set?prop=tempo');
    onLomEvent(55);
    // Yield so the .catch arm runs.
    await new Promise((r) => setImmediate(r));
  });

  it('the lom_event Max handler delegates to onLomEvent', () => {
    expect(typeof lomEventHandlers.lom_event).toBe('function');
    // String coercion — Max delivers atoms.
    expect(() => lomEventHandlers.lom_event('123')).not.toThrow();
  });
});

describe('registerResourceHandlers', () => {
  /**
   * @param sessionId
   * @returns {{ lowLevel: object, transport: object, handlers: object }}
   */
  function makeMcpServerMock(sessionId = 'session-x') {
    const handlers = {};
    const lowLevel = {
      registerCapabilities: jest.fn(),
      setRequestHandler: jest.fn((schema, fn) => {
        handlers[schema._tag] = fn;
      }),
    };
    return { mcpServer: { server: lowLevel }, transport: { sessionId }, handlers, lowLevel };
  }

  it('registers the resources capability with subscribe=true', () => {
    const { mcpServer, transport, lowLevel } = makeMcpServerMock();
    registerResourceHandlers(mcpServer, transport);
    expect(lowLevel.registerCapabilities).toHaveBeenCalledWith({
      resources: { subscribe: true, listChanged: false },
    });
  });

  it('subscribe handler stores the server reference and calls subscribe()', async () => {
    lom.lomObserve.mockResolvedValueOnce(101);
    const { mcpServer, transport, handlers } = makeMcpServerMock('sess-1');
    registerResourceHandlers(mcpServer, transport);
    const result = await handlers.subscribe({ params: { uri: 'live:///live_set?prop=tempo' } });
    expect(result).toEqual({});
    expect(_state.sessionServers.get('sess-1')).toBe(mcpServer.server);
    expect(_state.subs.has('live:///live_set?prop=tempo')).toBe(true);
  });

  it('subscribe handler throws when the transport has no sessionId yet', async () => {
    const mock = makeMcpServerMock();
    mock.transport.sessionId = undefined; // simulate pre-init transport
    const { mcpServer, transport, handlers } = mock;
    registerResourceHandlers(mcpServer, transport);
    await expect(handlers.subscribe({ params: { uri: 'live:///x?prop=y' } })).rejects.toThrow(
      /subscribe before session initialized/,
    );
  });

  it('unsubscribe handler delegates to unsubscribe()', async () => {
    lom.lomObserve.mockResolvedValueOnce(102);
    lom.lomUnobserve.mockResolvedValueOnce();
    const { mcpServer, transport, handlers } = makeMcpServerMock('sess-2');
    registerResourceHandlers(mcpServer, transport);
    await handlers.subscribe({ params: { uri: 'live:///live_set?prop=tempo' } });
    const result = await handlers.unsubscribe({ params: { uri: 'live:///live_set?prop=tempo' } });
    expect(result).toEqual({});
    expect(lom.lomUnobserve).toHaveBeenCalledWith(102);
  });

  it('unsubscribe handler throws when the transport has no sessionId', async () => {
    const mock = makeMcpServerMock();
    mock.transport.sessionId = undefined; // simulate pre-init transport
    const { mcpServer, transport, handlers } = mock;
    registerResourceHandlers(mcpServer, transport);
    await expect(handlers.unsubscribe({ params: { uri: 'live:///x?prop=y' } })).rejects.toThrow(
      /unsubscribe before session initialized/,
    );
  });

  it('read handler returns a JSON envelope with the snapshot value', async () => {
    lom.lomGet.mockResolvedValueOnce(140);
    const { mcpServer, transport, handlers } = makeMcpServerMock();
    registerResourceHandlers(mcpServer, transport);
    const result = await handlers.read({ params: { uri: 'live:///live_set?prop=tempo' } });
    expect(result.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(result.contents[0].text)).toEqual({
      path: 'live_set',
      prop: 'tempo',
      value: 140,
    });
  });

  it('read handler returns the bundled markdown for agent4live://guide (no LOM call)', async () => {
    const { mcpServer, transport, handlers } = makeMcpServerMock();
    registerResourceHandlers(mcpServer, transport);
    const result = await handlers.read({ params: { uri: 'agent4live://guide' } });
    expect(result.contents[0].uri).toBe('agent4live://guide');
    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(typeof result.contents[0].text).toBe('string');
    expect(result.contents[0].text.length).toBeGreaterThan(100);
    // Sanity: the lomGet path is bypassed for this URI.
    expect(lom.lomGet).not.toHaveBeenCalled();
  });

  it('list handler advertises the static usage-guide resource', async () => {
    const { mcpServer, transport, handlers } = makeMcpServerMock();
    registerResourceHandlers(mcpServer, transport);
    const result = await handlers.list();
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]).toMatchObject({
      uri: 'agent4live://guide',
      mimeType: 'text/markdown',
    });
    expect(result.resources[0].name.length).toBeGreaterThan(0);
  });
});
