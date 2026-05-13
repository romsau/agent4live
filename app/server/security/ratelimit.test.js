'use strict';

const ratelimit = require('./ratelimit');

beforeEach(() => {
  ratelimit._resetForTests();
});

describe('categorize', () => {
  it.each([
    ['/mcp', 'mcp'],
    ['/mcp?x=1', 'mcp'],
    ['/ui', 'ui'],
    ['/ui/state', 'ui'],
    ['/ui/fonts/x.ttf', 'ui'],
    ['/preferences', 'config'],
    ['/preferences/agent/claudeCode', 'config'],
    ['/preferences/reset', 'config'],
    ['/preferences/rotate-token', 'config'],
    ['/extension/install', 'config'],
    ['/extension/recheck', 'config'],
    ['/detect', 'config'],
  ])('maps %s → %s', (url, expected) => {
    expect(ratelimit.categorize(url)).toBe(expected);
  });

  it.each([['/unknown'], ['/foo/bar'], ['/mcpfoo'], ['/uifoo'], [''], [undefined]])(
    'returns null for unknown route %s',
    (url) => {
      expect(ratelimit.categorize(url)).toBeNull();
    },
  );
});

describe('take — token bucket maths', () => {
  it('starts with capacity tokens and decrements by 1 on each call', () => {
    // mcp bucket : burst 120. Drain it.
    for (let i = 0; i < 120; i++) {
      expect(ratelimit.take('mcp', 0).ok).toBe(true);
    }
    // 121st call (same instant) → rejected.
    const r = ratelimit.take('mcp', 0);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBe(1); // 1/60 round-up
  });

  it('refills lazily based on elapsed time', () => {
    // Drain mcp at t=0.
    for (let i = 0; i < 120; i++) ratelimit.take('mcp', 0);
    expect(ratelimit.take('mcp', 0).ok).toBe(false);
    // 0.5 s later : 30 tokens regenerated (refill 60/s × 0.5).
    expect(ratelimit.take('mcp', 500).ok).toBe(true); // consume 1
    // 29 tokens left at t=500. Drain them.
    for (let i = 0; i < 29; i++) {
      expect(ratelimit.take('mcp', 500).ok).toBe(true);
    }
    // 30th additional call at same instant → empty again.
    expect(ratelimit.take('mcp', 500).ok).toBe(false);
  });

  it('caps refill at bucket capacity (no overflow over long idle)', () => {
    // Consume 1 token, then wait an eternity.
    ratelimit.take('mcp', 0);
    // After 1 hour, still capped at 120.
    expect(ratelimit.take('mcp', 3600 * 1000).ok).toBe(true);
    // Drain it — should take exactly 120 calls from full, NOT 120 + accumulated.
    for (let i = 0; i < 119; i++) ratelimit.take('mcp', 3600 * 1000);
    expect(ratelimit.take('mcp', 3600 * 1000).ok).toBe(false);
  });

  it('handles backwards clock jumps without crashing (NTP correction)', () => {
    ratelimit.take('mcp', 1000);
    // Clock jumps backward — elapsed becomes negative, must clamp to 0.
    const r = ratelimit.take('mcp', 500);
    expect(r.ok).toBe(true); // still has tokens, but no refill from negative elapsed
  });

  it('retryAfter scales inversely with refill rate', () => {
    // config bucket : burst 10, refill 2/s.
    for (let i = 0; i < 10; i++) ratelimit.take('config', 0);
    const r = ratelimit.take('config', 0);
    expect(r.ok).toBe(false);
    // 1 token in 1/refillRate s = 0.5 s → ceil = 1 s.
    expect(r.retryAfter).toBe(1);
  });

  it('retryAfter is at least 1 s even when partial refill is sub-second', () => {
    // Drain mcp completely.
    for (let i = 0; i < 120; i++) ratelimit.take('mcp', 0);
    const r = ratelimit.take('mcp', 0);
    expect(r.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('defaults to Date.now() when no `now` is passed (production path)', () => {
    // First call without `now` — exercises the default parameter branch.
    const r = ratelimit.take('mcp');
    expect(r.ok).toBe(true);
  });
});

describe('rejectIfRateLimited', () => {
  /**
   * Minimal req/res doubles.
   * @param {string} url
   */
  function mk(url) {
    const req = { url, method: 'GET' };
    const res = {
      statusCode: null,
      headers: null,
      body: null,
      writeHead: jest.fn(function (status, headers) {
        this.statusCode = status;
        this.headers = headers;
      }),
      end: jest.fn(function (b) {
        this.body = b;
      }),
    };
    return { req, res };
  }

  it('returns false (proceed) on first call for a known route', () => {
    const { req, res } = mk('/mcp');
    expect(ratelimit.rejectIfRateLimited(req, res)).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it('returns false (proceed) for unknown routes — no throttle on 404 candidates', () => {
    const { req, res } = mk('/no/such/path');
    expect(ratelimit.rejectIfRateLimited(req, res)).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it('returns true + writes 429 + Retry-After + JSON body when bucket is empty', () => {
    // Drain the mcp bucket.
    for (let i = 0; i < 120; i++)
      ratelimit.rejectIfRateLimited(mk('/mcp').req, mk('/mcp').res, { now: 0 });
    const { req, res } = mk('/mcp');
    expect(ratelimit.rejectIfRateLimited(req, res, { now: 0 })).toBe(true);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['Retry-After']).toMatch(/^\d+$/);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('rate_limited');
    expect(body.category).toBe('mcp');
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('honors bypassMcpUntil when set and in the future', () => {
    // Drain mcp at t=0.
    for (let i = 0; i < 120; i++)
      ratelimit.rejectIfRateLimited(mk('/mcp').req, mk('/mcp').res, { now: 0 });
    // Without bypass : next call rejected.
    expect(ratelimit.rejectIfRateLimited(mk('/mcp').req, mk('/mcp').res, { now: 0 })).toBe(true);
    // With future bypass (at t=0, bypass valid until t=60000) : proceeds.
    expect(
      ratelimit.rejectIfRateLimited(mk('/mcp').req, mk('/mcp').res, {
        bypassMcpUntil: 60000,
        now: 0,
      }),
    ).toBe(false);
  });

  it('ignores expired bypass timestamps (in the past)', () => {
    for (let i = 0; i < 120; i++)
      ratelimit.rejectIfRateLimited(mk('/mcp').req, mk('/mcp').res, { now: 0 });
    // Bypass timestamp at t=-60000, current time t=0 → expired.
    expect(
      ratelimit.rejectIfRateLimited(mk('/mcp').req, mk('/mcp').res, {
        bypassMcpUntil: -60000,
        now: 0,
      }),
    ).toBe(true);
  });

  it('does NOT bypass for ui / config buckets even when bypassMcpUntil is set', () => {
    // Drain config at t=0.
    for (let i = 0; i < 10; i++)
      ratelimit.rejectIfRateLimited(mk('/preferences').req, mk('/preferences').res, { now: 0 });
    // config bucket still rejects despite bypassMcpUntil — bypass is /mcp-only.
    expect(
      ratelimit.rejectIfRateLimited(mk('/preferences').req, mk('/preferences').res, {
        bypassMcpUntil: 60000,
        now: 0,
      }),
    ).toBe(true);
  });

  // Log side-effect verified at the integration level (index.test.js where
  // `log` is mocked via the doMock infrastructure) — the destructured
  // import binding here can't be spied on after the require.
});

describe('BUCKETS calibration + env var overrides', () => {
  it('exposes the 3 calibrated buckets with expected defaults', () => {
    expect(ratelimit.BUCKETS.mcp).toEqual({ capacity: 120, refillRate: 60 });
    expect(ratelimit.BUCKETS.ui).toEqual({ capacity: 30, refillRate: 10 });
    expect(ratelimit.BUCKETS.config).toEqual({ capacity: 10, refillRate: 2 });
  });

  it('reloads with env var overrides when the module is freshly required', () => {
    jest.resetModules();
    process.env.AGENT4LIVE_RATELIMIT_MCP_BURST = '500';
    process.env.AGENT4LIVE_RATELIMIT_MCP_REFILL = '200';
    try {
      const fresh = require('./ratelimit');
      expect(fresh.BUCKETS.mcp).toEqual({ capacity: 500, refillRate: 200 });
    } finally {
      delete process.env.AGENT4LIVE_RATELIMIT_MCP_BURST;
      delete process.env.AGENT4LIVE_RATELIMIT_MCP_REFILL;
    }
  });

  it('falls back to default when env var is non-numeric or zero', () => {
    jest.resetModules();
    process.env.AGENT4LIVE_RATELIMIT_UI_BURST = 'abc';
    process.env.AGENT4LIVE_RATELIMIT_UI_REFILL = '0';
    try {
      const fresh = require('./ratelimit');
      expect(fresh.BUCKETS.ui).toEqual({ capacity: 30, refillRate: 10 });
    } finally {
      delete process.env.AGENT4LIVE_RATELIMIT_UI_BURST;
      delete process.env.AGENT4LIVE_RATELIMIT_UI_REFILL;
    }
  });
});
