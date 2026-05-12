'use strict';

const { isLocalOrigin, rejectIfNonLocalOrigin } = require('./auth');

describe('isLocalOrigin', () => {
  it('accepts absent origin (CLI / curl path)', () => {
    expect(isLocalOrigin(undefined)).toBe(true);
    expect(isLocalOrigin('')).toBe(true);
  });

  it('accepts http://localhost with or without port', () => {
    expect(isLocalOrigin('http://localhost')).toBe(true);
    expect(isLocalOrigin('http://localhost:23456')).toBe(true);
    expect(isLocalOrigin('https://localhost:8080')).toBe(true);
  });

  it('accepts http://127.0.0.1 with or without port', () => {
    expect(isLocalOrigin('http://127.0.0.1')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:23456')).toBe(true);
    expect(isLocalOrigin('https://127.0.0.1')).toBe(true);
  });

  it('rejects external origins', () => {
    expect(isLocalOrigin('http://evil.com')).toBe(false);
    expect(isLocalOrigin('https://example.org')).toBe(false);
  });

  it('rejects subdomain spoof (localhost.evil.com)', () => {
    expect(isLocalOrigin('http://localhost.evil.com')).toBe(false);
    expect(isLocalOrigin('http://127.0.0.1.evil.com')).toBe(false);
  });

  it('rejects scheme spoof (file://, javascript:, null)', () => {
    expect(isLocalOrigin('file://127.0.0.1')).toBe(false);
    expect(isLocalOrigin('javascript:alert(1)')).toBe(false);
    expect(isLocalOrigin('null')).toBe(false);
  });

  it('rejects path/query suffix on the host', () => {
    expect(isLocalOrigin('http://localhost/evil')).toBe(false);
    expect(isLocalOrigin('http://localhost?x=1')).toBe(false);
  });

  it('rejects look-alike hosts (0.0.0.0, 192.x, IPv6)', () => {
    expect(isLocalOrigin('http://0.0.0.0')).toBe(false);
    expect(isLocalOrigin('http://192.168.1.1')).toBe(false);
    expect(isLocalOrigin('http://[::1]')).toBe(false);
  });
});

describe('rejectIfNonLocalOrigin', () => {
  /**
   * Build minimal req/res doubles. Returns the mocks so the test can read
   * what the helper wrote.
   * @param {string} [origin]
   */
  function mk(origin) {
    const req = { headers: origin !== undefined ? { origin } : {} };
    const res = {
      statusCode: null,
      headers: null,
      body: null,
      writeHead: jest.fn(function (status, headers) {
        this.statusCode = status;
        this.headers = headers;
      }),
      end: jest.fn(function (body) {
        this.body = body;
      }),
    };
    return { req, res };
  }

  it('returns false and writes nothing when origin is local', () => {
    const { req, res } = mk('http://localhost:23456');
    expect(rejectIfNonLocalOrigin(req, res)).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('returns false when origin header is absent (CLI client)', () => {
    const { req, res } = mk(undefined);
    expect(rejectIfNonLocalOrigin(req, res)).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it('returns true and writes 403 JSON when origin is non-local', () => {
    const { req, res } = mk('http://evil.com');
    expect(rejectIfNonLocalOrigin(req, res)).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(403, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden_origin' });
  });
});
