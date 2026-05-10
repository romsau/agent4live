'use strict';

// MCP transport bridge: HTTP <-> MCP SDK's WebStandardStreamableHTTPServerTransport.
// Stateful sessions are kept in `sessions` keyed by Mcp-Session-Id. Each
// session has its own McpServer + transport pair so SSE subscriptions stay
// isolated per client.

const crypto = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  WebStandardStreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js');

const { PORT, SERVER_NAME, SERVER_VERSION } = require('../config');
const { uiState, log } = require('../ui/state');
const tools = require('../tools');
const sse = require('./sse');

/**
 * CSRF defense — only accept requests whose Origin header points to localhost
 * (or has no Origin at all, which means a non-browser client like an agent
 * CLI).
 *
 * @param {string|undefined} origin - Request's Origin header.
 * @returns {boolean}
 */
function isLocalOrigin(origin) {
  if (!origin) return true;
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

/**
 * Validate Origin + Bearer token. Writes the appropriate error response and
 * returns false on failure ; returns true on success.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {boolean}
 */
function checkAuth(req, res) {
  const origin = req.headers.origin;
  if (!isLocalOrigin(origin)) {
    log('auth: rejected non-local origin ' + origin);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden_origin' }));
    return false;
  }
  const expected = uiState.token;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'token_not_ready' }));
    return false;
  }
  const auth = req.headers.authorization || '';
  const bearerMatch = /^Bearer (.+)$/.exec(auth);
  if (!bearerMatch || bearerMatch[1] !== expected) {
    log('auth: rejected request with ' + (auth ? 'invalid' : 'missing') + ' bearer');
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer realm="${SERVER_NAME}"`,
    });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
  }
  return true;
}

/**
 * Register every tool family on the given McpServer instance.
 *
 * @param {McpServer} server
 */
function registerTools(server) {
  tools.raw.register(server);
  tools.session.register(server);
  tools.transport.register(server);
  tools.tracks.register(server);
  tools.clips.register(server);
  tools.scenes.register(server);
  tools.arrangement.register(server);
  tools.application.register(server);
  tools.racks.register(server);
  tools.instruments.register(server);
  tools.browser.register(server);
  tools.tuning.register(server);
  tools.midi.register(server);
  tools.meta.register(server);
}

// Stateful sessions registry. Each entry holds the live transport + McpServer
// pair plus the sessionId. When a session is GCed (DELETE, transport.onclose),
// we release all its subscriptions to avoid orphan LiveAPI observers.
const sessions = new Map(); // sessionId -> { transport, server }

/**
 * Build a fresh transport + McpServer pair for a new MCP session. Wires
 * SSE resource handlers and lifecycle cleanup so observers are freed when
 * the session closes.
 *
 * @returns {{ transport: WebStandardStreamableHTTPServerTransport, server: McpServer }}
 */
function makeSession() {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { transport, server });
      log(`mcp: session initialized ${sessionId}`);
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
      sse.releaseSession(sessionId);
      log(`mcp: session closed ${sessionId}`);
    },
  });
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server);
  sse.registerResourceHandlers(server, transport);
  // Also clean up if the transport itself dies (e.g. SSE stream broken).
  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
      sse.releaseSession(transport.sessionId);
      log(`mcp: transport closed for session ${transport.sessionId}`);
    }
  };
  return { transport, server };
}

/**
 * Handle a single /mcp HTTP request. Routes by Mcp-Session-Id header, creates
 * a new session on miss, then forwards to the SDK transport. SSE responses
 * (GET) get headers flushed immediately so clients don't time out waiting
 * for the first notification.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleMCP(req, res) {
  log(`mcp: ${req.method} ${req.url} sid=${req.headers['mcp-session-id'] || 'none'}`);
  if (!checkAuth(req, res)) return;

  // Only POST has a body. GET (SSE channel) and DELETE don't, and reading
  // the empty stream from a keep-alive connection can stall.
  let body = Buffer.alloc(0);
  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  log(`mcp: ${req.method} body read (len=${body.length})`);

  const sessionId = req.headers['mcp-session-id'];
  let entry = sessionId ? sessions.get(sessionId) : null;
  if (!entry) {
    log(`mcp: creating new session (had sid=${!!sessionId})`);
    entry = makeSession();
    await entry.server.connect(entry.transport);
  } else {
    log(`mcp: reusing session ${sessionId}`);
  }

  const webReq = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers: new Headers(req.headers),
    body: body.length > 0 ? body : undefined,
  });

  log(`mcp: calling transport.handleRequest`);
  const webRes = await entry.transport.handleRequest(webReq);
  log(`mcp: got webRes status=${webRes.status} hasBody=${!!webRes.body}`);

  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
  // Flush headers immediately. SSE streams produce no body bytes until the
  // first notification arrives, so without an explicit flush the client
  // sees nothing for an arbitrary delay (and may time out before any event).
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  if (webRes.body) {
    const reader = webRes.body.getReader();
    const onAbort = () => {
      try {
        reader.cancel();
      } catch (_) {}
    };
    res.on('close', onAbort);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch (_) {}
    res.off('close', onAbort);
  }
  res.end();
  log(`mcp: ${req.method} done`);
}

module.exports = { registerTools, handleMCP, sessions };
