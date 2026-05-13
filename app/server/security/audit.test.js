'use strict';

/**
 * Load the audit module against the given fs mock. Reset module cache so
 * each test starts with no state.
 *
 * @param {object} fsMock
 * @returns {object}
 */
function loadAuditWithFs(fsMock) {
  jest.resetModules();
  jest.doMock('fs', () => fsMock);
  return require('./audit');
}

describe('hashToken', () => {
  let audit;
  beforeEach(() => {
    audit = loadAuditWithFs({
      mkdirSync: jest.fn(),
      appendFileSync: jest.fn(),
      chmodSync: jest.fn(),
    });
  });

  it('returns 8 hex chars for a real token', () => {
    const h = audit.hashToken('a'.repeat(32));
    expect(h).toMatch(/^[a-f0-9]{8}$/);
  });

  it('returns deterministic output (same token → same hash)', () => {
    expect(audit.hashToken('abc')).toBe(audit.hashToken('abc'));
  });

  it('returns different hashes for different tokens', () => {
    expect(audit.hashToken('token-1')).not.toBe(audit.hashToken('token-2'));
  });

  it('returns "none" for falsy values (null / undefined / empty)', () => {
    expect(audit.hashToken(null)).toBe('none');
    expect(audit.hashToken(undefined)).toBe('none');
    expect(audit.hashToken('')).toBe('none');
  });

  it('never leaks the original token in the output', () => {
    const longToken = 'super-secret-bearer-token-do-not-leak';
    expect(audit.hashToken(longToken)).not.toContain('secret');
    expect(audit.hashToken(longToken)).not.toContain('bearer');
  });
});

describe('auditLog', () => {
  it('writes an ISO timestamp + action + key=value pairs in newline-terminated format', () => {
    const fs = {
      mkdirSync: jest.fn(),
      appendFileSync: jest.fn(),
      chmodSync: jest.fn(),
    };
    const audit = loadAuditWithFs(fs);
    audit.auditLog('register', { agent: 'claudeCode', tokenHash: 'abc12345' });
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    const [path, line, opts] = fs.appendFileSync.mock.calls[0];
    expect(path).toBe(audit.AUDIT_FILE);
    expect(opts).toEqual({ mode: 0o600 });
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z register agent=claudeCode tokenHash=abc12345\n$/,
    );
  });

  it('writes action alone when details is empty', () => {
    const fs = {
      mkdirSync: jest.fn(),
      appendFileSync: jest.fn(),
      chmodSync: jest.fn(),
    };
    const audit = loadAuditWithFs(fs);
    audit.auditLog('boot');
    const line = fs.appendFileSync.mock.calls[0][1];
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z boot\n$/);
  });

  it('creates the audit dir if missing (mkdirSync recursive)', () => {
    const fs = {
      mkdirSync: jest.fn(),
      appendFileSync: jest.fn(),
      chmodSync: jest.fn(),
    };
    const audit = loadAuditWithFs(fs);
    audit.auditLog('register', { agent: 'x' });
    expect(fs.mkdirSync).toHaveBeenCalledWith(audit.AUDIT_DIR, { recursive: true });
  });

  it('forces chmod 0o600 even when the file pre-existed with looser perms', () => {
    const fs = {
      mkdirSync: jest.fn(),
      appendFileSync: jest.fn(),
      chmodSync: jest.fn(),
    };
    const audit = loadAuditWithFs(fs);
    audit.auditLog('register', { agent: 'x' });
    expect(fs.chmodSync).toHaveBeenCalledWith(audit.AUDIT_FILE, 0o600);
  });

  it('swallows chmod failures (best-effort)', () => {
    const fs = {
      mkdirSync: jest.fn(),
      appendFileSync: jest.fn(),
      chmodSync: jest.fn(() => {
        throw new Error('chmod boom');
      }),
    };
    const audit = loadAuditWithFs(fs);
    // Should NOT throw — chmod failure is non-fatal.
    expect(() => audit.auditLog('register', { agent: 'x' })).not.toThrow();
  });

  it('never throws when append fails (disk full, perms, etc.)', () => {
    const fs = {
      mkdirSync: jest.fn(),
      appendFileSync: jest.fn(() => {
        throw new Error('ENOSPC');
      }),
      chmodSync: jest.fn(),
    };
    const audit = loadAuditWithFs(fs);
    expect(() => audit.auditLog('register', { agent: 'x' })).not.toThrow();
  });

  it('never throws when mkdir fails', () => {
    const fs = {
      mkdirSync: jest.fn(() => {
        throw new Error('EACCES');
      }),
      appendFileSync: jest.fn(),
      chmodSync: jest.fn(),
    };
    const audit = loadAuditWithFs(fs);
    expect(() => audit.auditLog('register', { agent: 'x' })).not.toThrow();
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });
});
