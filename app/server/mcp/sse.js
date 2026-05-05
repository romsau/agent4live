'use strict';

// Subscription manager for streaming LOM observers via MCP resources.
//
// URI scheme: `live:///<lom-path-with-slashes>?prop=<prop>&throttle_ms=<ms>`
//   Examples:
//     live:///live_set?prop=tempo
//     live:///live_set/tracks/0?prop=mute
//     live:///live_set/tracks/0/mixer_device/volume?prop=value
//     live:///live_set/tracks/0/clip_slots/0/clip?prop=playing_position&throttle_ms=100
//
//   Convention: the LOM path is space-separated (e.g. "live_set tracks 0"), so
//   we represent it in the URI by replacing spaces with slashes. The prop is
//   always in the query string for unambiguous parsing. Default throttle is
//   100ms unless explicitly specified.
//
// Lifecycle:
//   - subscribe(sessionId, uri): looks up or creates an entry for the URI.
//     If it's the first subscriber, asks Max [js] to start observing
//     (lomObserve) and stores the resulting observerId. Otherwise just
//     bumps the session set.
//   - unsubscribe(sessionId, uri): removes session from the entry's set.
//     If the set becomes empty, asks Max [js] to stop observing
//     (lomUnobserve) and drops the entry.
//   - releaseSession(sessionId): walks all entries, removes the session,
//     and frees observers that lose their last subscriber. Called when
//     a session closes (DELETE) or its transport dies (HTTP disconnect).
//   - onLomEvent(observerId): fired when Max pushes a 'lom_event'.
//     Looks up the URI for that observerId and fans out
//     notifications/resources/updated to every subscribed session.

const {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const Max = require('max-api');

const { DEFAULT_THROTTLE_MS } = require('../config');
const { log } = require('../ui/state');
const { lomGet, lomObserve, lomUnobserve } = require('../lom');
const { GUIDE, GUIDE_URI, GUIDE_NAME, GUIDE_DESCRIPTION, GUIDE_MIME } = require('../skill');

// uri -> { sessions: Set<sessionId>, observerId: number|null,
//          path: string, prop: string, throttle_ms: number }
const subs = new Map();
// observerId -> uri (reverse lookup for fan-out on lom_event)
const observerToUri = new Map();
// sessionId -> McpServer (used to call sendResourceUpdated)
const sessionServers = new Map();

/**
 * Parse a `live://` resource URI into its LOM path / property / throttle parts.
 * Hand-parses rather than using URL() because Node's URL parser mangles the
 * empty-authority form.
 *
 * @param {string} uri - Format: `live:///<path>?prop=<prop>[&throttle_ms=<ms>]`
 * @returns {{ path: string, prop: string, throttle_ms: number }}
 * @throws {Error} when the URI is malformed or `?prop=` is missing.
 */
function parseUri(uri) {
  const match = String(uri).match(/^live:\/\/(?:[^/]*)\/(.+?)(?:\?(.*))?$/);
  if (!match) throw new Error(`Invalid live:// URI: ${uri}`);
  const pathSlashes = match[1];
  const querystring = match[2] || '';
  const path = pathSlashes.split('/').join(' ');
  const params = new URLSearchParams(querystring);
  const prop = params.get('prop');
  if (!prop) throw new Error(`URI missing required ?prop=...: ${uri}`);
  const throttleRaw = params.get('throttle_ms');
  const throttle_ms =
    throttleRaw === null ? DEFAULT_THROTTLE_MS : Math.max(0, parseInt(throttleRaw, 10));
  return { path, prop, throttle_ms };
}

/**
 * Subscribe a session to a URI. Lazy-creates the underlying LiveAPI observer
 * on first subscriber (ref-counted).
 *
 * @param {string} sessionId
 * @param {string} uri
 */
async function subscribe(sessionId, uri) {
  let entry = subs.get(uri);
  if (!entry) {
    const { path, prop, throttle_ms } = parseUri(uri);
    const observerId = await lomObserve(path, prop, throttle_ms);
    entry = { sessions: new Set(), observerId, path, prop, throttle_ms };
    subs.set(uri, entry);
    observerToUri.set(observerId, uri);
    log(
      `sse: observer started id=${observerId} path="${path}" prop=${prop} throttle=${throttle_ms}ms`,
    );
  }
  entry.sessions.add(sessionId);
  log(`sse: subscribe session=${sessionId} uri=${uri} (${entry.sessions.size} subscriber(s))`);
}

/**
 * Unsubscribe a session from a URI. Frees the underlying LiveAPI observer
 * when the last subscriber leaves.
 *
 * @param {string} sessionId
 * @param {string} uri
 */
async function unsubscribe(sessionId, uri) {
  const entry = subs.get(uri);
  if (!entry) return;
  entry.sessions.delete(sessionId);
  if (entry.sessions.size === 0) {
    if (entry.observerId !== null && entry.observerId !== undefined) {
      try {
        await lomUnobserve(entry.observerId);
      } catch (err) {
        log(`sse: unobserve failed: ${err.message}`);
      }
      observerToUri.delete(entry.observerId);
    }
    subs.delete(uri);
    log(`sse: observer freed for ${uri} (last subscriber gone)`);
  }
}

/**
 * Drop all subscriptions held by a session. Called when the MCP session
 * closes (DELETE) or its transport dies (HTTP disconnect). Frees observers
 * that lose their last subscriber as a side effect.
 *
 * @param {string} sessionId
 */
async function releaseSession(sessionId) {
  sessionServers.delete(sessionId);
  // Snapshot keys because we mutate the map during the loop.
  const uris = Array.from(subs.keys());
  for (const uri of uris) {
    const entry = subs.get(uri);
    if (entry && entry.sessions.has(sessionId)) {
      await unsubscribe(sessionId, uri);
    }
  }
}

/**
 * Called by the bridge whenever Max pushes a `lom_event` for one of our
 * active observers. Fans out a `notifications/resources/updated` to every
 * subscribed session.
 *
 * @param {number} observerId
 */
function onLomEvent(observerId) {
  const uri = observerToUri.get(observerId);
  if (!uri) {
    log(`sse: lom_event for unknown observerId ${observerId} (already freed?)`);
    return;
  }
  const entry = subs.get(uri);
  if (!entry) return;
  for (const sid of entry.sessions) {
    const server = sessionServers.get(sid);
    if (!server) continue;
    server.sendResourceUpdated({ uri }).catch((err) => {
      log(`sse: sendResourceUpdated failed for session ${sid}: ${err.message}`);
    });
  }
}

// Wire the lom_event handler once at module load.
Max.addHandler('lom_event', (observerId) => {
  onLomEvent(Number(observerId));
});

/**
 * Register the MCP resource request handlers (subscribe, unsubscribe, read)
 * on a freshly-created McpServer. Called by mcp/server.js#makeSession() for
 * each new session.
 *
 * @param {McpServer} mcpServer
 * @param {WebStandardStreamableHTTPServerTransport} transport
 */
function registerResourceHandlers(mcpServer, transport) {
  const lowLevel = mcpServer.server;

  // Declare resources capability with subscribe=true so clients know they
  // can call resources/subscribe. listChanged stays false: we don't surface
  // a fully-dynamic discovery (live:// URIs are unlimited), but resources/list
  // does return the static `agent4live://guide` so agents can discover the
  // usage guide without prior knowledge of the scheme.
  lowLevel.registerCapabilities({
    resources: { subscribe: true, listChanged: false },
  });

  // Static resource discovery: only surfaces the usage guide. live:// URIs
  // are constructed by the agent from a known LOM path + prop and are not
  // listable.
  lowLevel.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: GUIDE_URI,
        name: GUIDE_NAME,
        description: GUIDE_DESCRIPTION,
        mimeType: GUIDE_MIME,
      },
    ],
  }));

  lowLevel.setRequestHandler(SubscribeRequestSchema, async (req) => {
    const sid = transport.sessionId;
    if (!sid) throw new Error('subscribe before session initialized');
    sessionServers.set(sid, lowLevel);
    await subscribe(sid, req.params.uri);
    return {};
  });

  lowLevel.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    const sid = transport.sessionId;
    if (!sid) throw new Error('unsubscribe before session initialized');
    await unsubscribe(sid, req.params.uri);
    return {};
  });

  // Read = one-shot snapshot. The static `agent4live://guide` is served from
  // the bundled markdown ; everything else is a live:// URI parsed + dispatched
  // to lomGet.
  lowLevel.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri === GUIDE_URI) {
      return {
        contents: [
          {
            uri: GUIDE_URI,
            mimeType: GUIDE_MIME,
            text: GUIDE,
          },
        ],
      };
    }
    const { path, prop } = parseUri(req.params.uri);
    const value = await lomGet(path, prop);
    return {
      contents: [
        {
          uri: req.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify({ path, prop, value }),
        },
      ],
    };
  });
}

module.exports = {
  parseUri,
  subscribe,
  unsubscribe,
  releaseSession,
  onLomEvent,
  registerResourceHandlers,
  // exposed for testing
  _state: { subs, observerToUri, sessionServers },
};
