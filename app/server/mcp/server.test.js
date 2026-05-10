'use strict';

// Mock the MCP SDK + collaborators so we can drive the bridge without spinning
// up real transports.
const McpServerCtor = jest.fn().mockImplementation(function () {
  this.connect = jest.fn(async () => {});
});
const TransportCtor = jest.fn().mockImplementation(function (opts) {
  this._opts = opts;
  this.sessionId = null;
  this.handleRequest = jest.fn();
  this.onclose = null;
});

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({ McpServer: McpServerCtor }));
jest.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: TransportCtor,
}));
jest.mock('../config', () => ({
  PORT: 12345,
  SERVER_NAME: 'agent4live-ableton',
  SERVER_VERSION: '0.0.0-test',
}));
jest.mock('../ui/state', () => ({
  uiState: { token: null },
  log: jest.fn(),
}));
jest.mock('../tools', () => {
  const fams = [
    'raw',
    'session',
    'transport',
    'tracks',
    'clips',
    'scenes',
    'arrangement',
    'application',
    'racks',
    'instruments',
    'browser',
    'tuning',
    'midi',
    'meta',
  ];
  const result = {};
  for (const fam of fams) result[fam] = { register: jest.fn() };
  return result;
});
jest.mock('./sse', () => ({
  registerResourceHandlers: jest.fn(),
  releaseSession: jest.fn(),
}));

const { uiState, log } = require('../ui/state');
const sse = require('./sse');
const tools = require('../tools');
const mcp = require('./server');

beforeEach(() => {
  jest.clearAllMocks();
  uiState.token = 'good-token';
  mcp.sessions.clear();
});

/**
 * Make a request stub. By default, body is empty and method is POST.
 * @param root0
 * @param root0.method
 * @param root0.url
 * @param root0.headers
 * @param root0.body
 */
function makeReq({ method = 'POST', url = '/mcp', headers = {}, body = '' } = {}) {
  const buf = Buffer.from(body);
  const req = {
    method,
    url,
    headers: { authorization: 'Bearer good-token', ...headers },
  };
  req[Symbol.asyncIterator] = async function* () {
    if (buf.length > 0) yield buf;
  };
  return req;
}

function makeRes() {
  const res = {
    statusCode: null,
    chunks: [],
    headers: null,
    ended: false,
    flushed: false,
    listeners: new Map(),
    writeHead: jest.fn(function (status, headers) {
      this.statusCode = status;
      this.headers = headers;
    }),
    write: jest.fn(function (chunk) {
      this.chunks.push(chunk);
    }),
    end: jest.fn(function (...args) {
      if (args[0]) this.chunks.push(args[0]);
      this.ended = true;
    }),
    on: jest.fn(function (evt, cb) {
      this.listeners.set(evt, cb);
    }),
    off: jest.fn(function (evt) {
      this.listeners.delete(evt);
    }),
    flushHeaders: jest.fn(function () {
      this.flushed = true;
    }),
  };
  return res;
}

describe('registerTools', () => {
  it('calls register on every family', () => {
    const fakeServer = {};
    mcp.registerTools(fakeServer);
    for (const fam of [
      'raw',
      'session',
      'transport',
      'tracks',
      'clips',
      'scenes',
      'arrangement',
      'application',
      'racks',
      'instruments',
      'browser',
      'tuning',
      'midi',
      'meta',
    ]) {
      expect(tools[fam].register).toHaveBeenCalledWith(fakeServer);
    }
  });
});

describe('checkAuth (via handleMCP)', () => {
  it('rejects non-local Origin with 403', async () => {
    const req = makeReq({ headers: { origin: 'https://evil.com' } });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.chunks[0]).error).toBe('forbidden_origin');
  });

  it('accepts requests with no Origin header', async () => {
    uiState.token = null; // force 503 to short-circuit before transport
    const req = makeReq({ headers: { origin: undefined } });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.chunks[0]).error).toBe('token_not_ready');
  });

  it('accepts http://127.0.0.1 origin', async () => {
    uiState.token = null;
    const req = makeReq({ headers: { origin: 'http://127.0.0.1:8765' } });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(res.statusCode).toBe(503);
  });

  it('accepts http://localhost origin', async () => {
    uiState.token = null;
    const req = makeReq({ headers: { origin: 'http://localhost' } });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(res.statusCode).toBe(503);
  });

  it('responds 401 when bearer is missing', async () => {
    const req = makeReq({ headers: { authorization: '' } });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe('Bearer realm="agent4live-ableton"');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('missing bearer'));
  });

  it('responds 401 when bearer is invalid', async () => {
    const req = makeReq({ headers: { authorization: 'Bearer wrong' } });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(res.statusCode).toBe(401);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('invalid bearer'));
  });
});

describe('handleMCP (full flow)', () => {
  /**
   * Build a fake Web Response-like object the transport returns. Body is an
   * AsyncIterable converted to a ReadableStream-like getReader() shape.
   * @param root0
   * @param root0.status
   * @param root0.body
   * @param root0.headers
   */
  function fakeWebRes({ status = 200, body = null, headers = {} } = {}) {
    let bodyObj = null;
    if (body) {
      const chunks = body.slice();
      bodyObj = {
        getReader() {
          return {
            read: jest.fn(() => {
              if (chunks.length === 0) return Promise.resolve({ done: true });
              return Promise.resolve({ done: false, value: chunks.shift() });
            }),
            cancel: jest.fn(),
          };
        },
      };
    }
    return {
      status,
      body: bodyObj,
      headers: { entries: () => Object.entries(headers) },
    };
  }

  it('creates a new session on first request and forwards to transport', async () => {
    const req = makeReq({ method: 'POST', body: '{"jsonrpc":"2.0"}' });
    const res = makeRes();

    // The transport ctor stub stores opts on `this`. We need the call to
    // handleRequest to return a fake WebRes.
    TransportCtor.mockImplementationOnce(function (opts) {
      this._opts = opts;
      this.sessionId = null;
      this.handleRequest = jest.fn(async () => fakeWebRes({ status: 200 }));
      this.onclose = null;
    });

    await mcp.handleMCP(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.flushed).toBe(true);
    expect(res.ended).toBe(true);
  });

  it('reuses an existing session on subsequent request', async () => {
    // Inject a fake session manually.
    const transport = {
      handleRequest: jest.fn(async () => fakeWebRes({ status: 200 })),
    };
    mcp.sessions.set('sid-1', { transport, server: {} });

    const req = makeReq({ method: 'POST', headers: { 'mcp-session-id': 'sid-1' }, body: '{}' });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(transport.handleRequest).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('mcp: reusing session sid-1');
  });

  it('GET request skips body read', async () => {
    const transport = {
      handleRequest: jest.fn(async () => fakeWebRes({ status: 200 })),
    };
    mcp.sessions.set('sid-1', { transport, server: {} });

    const req = makeReq({ method: 'GET', headers: { 'mcp-session-id': 'sid-1' } });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(log).toHaveBeenCalledWith('mcp: GET body read (len=0)');
  });

  it('streams body chunks from webRes.body to res.write', async () => {
    const transport = {
      handleRequest: jest.fn(async () => fakeWebRes({ status: 200, body: ['chunk-a', 'chunk-b'] })),
    };
    mcp.sessions.set('sid-1', { transport, server: {} });

    const req = makeReq({ headers: { 'mcp-session-id': 'sid-1' }, body: '{}' });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(res.chunks).toEqual(['chunk-a', 'chunk-b']);
  });

  it('registers a close listener that cancels the reader on abort', async () => {
    const cancelSpy = jest.fn();
    const transport = {
      handleRequest: jest.fn(async () => ({
        status: 200,
        headers: { entries: () => [] },
        body: {
          getReader() {
            return {
              read: jest.fn(() => Promise.resolve({ done: true })),
              cancel: cancelSpy,
            };
          },
        },
      })),
    };
    mcp.sessions.set('sid-1', { transport, server: {} });

    const req = makeReq({ headers: { 'mcp-session-id': 'sid-1' }, body: '{}' });
    const res = makeRes();
    // Capture the close handler the moment it's registered, then invoke it
    // ourselves to verify cancel() is wrapped in try/catch.
    let captured;
    const origOn = res.on;
    res.on = jest.fn(function (evt, cb) {
      origOn.call(this, evt, cb);
      if (evt === 'close') captured = cb;
    });

    await mcp.handleMCP(req, res);
    expect(typeof captured).toBe('function');

    // Drive the close path. cancel throws → swallowed by try/catch.
    cancelSpy.mockImplementation(() => {
      throw new Error('already closed');
    });
    expect(() => captured()).not.toThrow();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('skips flushHeaders when the response has no flushHeaders method', async () => {
    const transport = {
      handleRequest: jest.fn(async () => fakeWebRes({ status: 200 })),
    };
    mcp.sessions.set('sid-1', { transport, server: {} });

    const req = makeReq({ headers: { 'mcp-session-id': 'sid-1' }, body: '{}' });
    const res = makeRes();
    delete res.flushHeaders;
    await mcp.handleMCP(req, res);
    expect(res.ended).toBe(true);
  });

  it('handles webRes with no body (DELETE flow)', async () => {
    const transport = {
      handleRequest: jest.fn(async () => fakeWebRes({ status: 204, body: null })),
    };
    mcp.sessions.set('sid-1', { transport, server: {} });

    const req = makeReq({ method: 'DELETE', headers: { 'mcp-session-id': 'sid-1' } });
    const res = makeRes();
    await mcp.handleMCP(req, res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.write).not.toHaveBeenCalled();
  });
});

describe('makeSession lifecycle', () => {
  /**
   * Drive a fresh session creation through handleMCP, then exercise the
   * captured transport opts (onsessioninitialized / onsessionclosed / onclose).
   */
  it('wires onsessioninitialized → sessions.set + log', async () => {
    let captured;
    TransportCtor.mockImplementationOnce(function (opts) {
      captured = opts;
      this._opts = opts;
      this.sessionId = null;
      this.handleRequest = jest.fn(async () => ({
        status: 200,
        headers: { entries: () => [] },
        body: null,
      }));
      this.onclose = null;
    });
    await mcp.handleMCP(makeReq(), makeRes());

    captured.onsessioninitialized('sid-X');
    expect(mcp.sessions.has('sid-X')).toBe(true);
    expect(log).toHaveBeenCalledWith('mcp: session initialized sid-X');

    captured.onsessionclosed('sid-X');
    expect(mcp.sessions.has('sid-X')).toBe(false);
    expect(sse.releaseSession).toHaveBeenCalledWith('sid-X');
    expect(log).toHaveBeenCalledWith('mcp: session closed sid-X');

    // sessionIdGenerator returns a UUID-shaped string.
    const id = captured.sessionIdGenerator();
    expect(typeof id).toBe('string');
  });

  it('transport.onclose with sessionId set → cleanup', async () => {
    let createdTransport;
    TransportCtor.mockImplementationOnce(function (opts) {
      this._opts = opts;
      this.sessionId = 'tx-sid';
      this.handleRequest = jest.fn(async () => ({
        status: 200,
        headers: { entries: () => [] },
        body: null,
      }));
      this.onclose = null;
      createdTransport = this;
    });
    mcp.sessions.set('tx-sid', { transport: {}, server: {} });
    await mcp.handleMCP(makeReq(), makeRes());

    createdTransport.onclose();
    expect(mcp.sessions.has('tx-sid')).toBe(false);
    expect(sse.releaseSession).toHaveBeenCalledWith('tx-sid');
  });

  it('transport.onclose without sessionId → no cleanup', async () => {
    let createdTransport;
    TransportCtor.mockImplementationOnce(function (opts) {
      this._opts = opts;
      this.sessionId = null;
      this.handleRequest = jest.fn(async () => ({
        status: 200,
        headers: { entries: () => [] },
        body: null,
      }));
      this.onclose = null;
      createdTransport = this;
    });
    await mcp.handleMCP(makeReq(), makeRes());

    sse.releaseSession.mockClear();
    createdTransport.onclose();
    expect(sse.releaseSession).not.toHaveBeenCalled();
  });
});
