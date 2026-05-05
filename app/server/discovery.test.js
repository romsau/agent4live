'use strict';

// Discovery is full of fs + subprocess side-effects. We mock both so the
// test never touches the real filesystem or spawns binaries. Each test resets
// mocks then describes its scenario via mockImplementation/mockReturnValueOnce.

jest.mock('fs');
jest.mock('child_process');
jest.mock('./config', () => ({
  SERVER_NAME: 'agent4live-ableton',
  SUBPROCESS_TIMEOUT_MS: 5000,
  AGENT_REGISTRATION_TIMEOUT_MS: 10000,
  TOKEN_BYTES: 16,
}));
jest.mock('./ui/state', () => ({
  uiState: {
    agents: {
      claudeCode: { detected: false, registered: false },
      codex: { detected: false, registered: false },
      gemini: { detected: false, registered: false },
      opencode: { detected: false, registered: false },
    },
  },
  log: jest.fn(),
}));

const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const os = require('os');
const { uiState, log } = require('./ui/state');

const HOME = os.homedir();
const ENDPOINT_FILE = path.join(HOME, '.agent4live-ableton-mcp', 'endpoint.json');
const OPENCODE_CONFIG = path.join(HOME, '.config', 'opencode', 'opencode.json');

// Helper: a fully-consented prefs object — used to drive setupConsentedClients
// in the same scenarios the legacy setupAllClients used to cover.
const ALL_CONSENTED = {
  agents: {
    claudeCode: { consented: true, consented_at: 'x', url_at_consent: 'x' },
    codex: { consented: true, consented_at: 'x', url_at_consent: 'x' },
    gemini: { consented: true, consented_at: 'x', url_at_consent: 'x' },
    opencode: { consented: true, consented_at: 'x', url_at_consent: 'x' },
  },
};

beforeEach(() => {
  jest.resetAllMocks();
  for (const agent of Object.keys(uiState.agents)) {
    uiState.agents[agent].detected = false;
    uiState.agents[agent].registered = false;
  }
});

// setupAllClients now returns a Promise. To keep tests concise, this
// afterEach awaits one tick so the trailing .finally(clearTimeout) hops
// from withRegistrationTimeout (when a test forgot to await) drain before
// Jest considers the run complete — otherwise the 10s setTimeout shows up
// as a pending handle.
afterEach(async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
});

const discovery = require('./discovery');

describe('detectClaude', () => {
  it('marks claudeCode detected when claude bin resolves', () => {
    cp.execFileSync.mockReturnValue('claude 1.0.0\n');
    discovery.detectClaude();
    expect(uiState.agents.claudeCode.detected).toBe(true);
  });

  it('logs not-found when no candidate matches and shell fallback fails', () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    discovery.detectClaude();
    expect(uiState.agents.claudeCode.detected).toBe(false);
    expect(log).toHaveBeenCalledWith('claude not found in PATH');
  });
});

describe('setupDiscovery', () => {
  it('writes endpoint.json with token returned, then re-registers Claude', () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.chmodSync.mockImplementation(() => {});
    cp.execFileSync.mockReturnValue('claude\n');

    const token = discovery.setupDiscovery(8765);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      ENDPOINT_FILE,
      expect.stringContaining(`"url":"http://127.0.0.1:8765/mcp"`),
      { mode: 0o600 },
    );
  });

  it('returns null and logs when the write fails', () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(discovery.setupDiscovery(1)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Discovery file write failed'));
  });

  it('swallows chmod failures (best-effort)', () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.chmodSync.mockImplementation(() => {
      throw new Error('chmod boom');
    });
    cp.execFileSync.mockReturnValue('claude\n');
    expect(discovery.setupDiscovery(1)).toMatch(/^[a-f0-9]{32}$/);
  });

  it('reuses existing valid token from endpoint.json', () => {
    const validToken = 'a'.repeat(32);
    fs.existsSync.mockImplementation((p) => p === ENDPOINT_FILE);
    fs.readFileSync.mockReturnValue(JSON.stringify({ token: validToken }));
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.chmodSync.mockImplementation(() => {});
    cp.execFileSync.mockReturnValue('claude\n');
    expect(discovery.setupDiscovery(1)).toBe(validToken);
  });

  it('regenerates token when endpoint.json has invalid token field', () => {
    fs.existsSync.mockImplementation((p) => p === ENDPOINT_FILE);
    fs.readFileSync.mockReturnValue(JSON.stringify({ token: 'too-short' }));
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.chmodSync.mockImplementation(() => {});
    cp.execFileSync.mockReturnValue('claude\n');
    const t = discovery.setupDiscovery(1);
    expect(t).toMatch(/^[a-f0-9]{32}$/);
    expect(t).not.toBe('too-short');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('token field invalid'));
  });

  it('regenerates token when endpoint.json is malformed JSON', () => {
    fs.existsSync.mockImplementation((p) => p === ENDPOINT_FILE);
    fs.readFileSync.mockReturnValue('{not-json');
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.chmodSync.mockImplementation(() => {});
    cp.execFileSync.mockReturnValue('claude\n');
    expect(discovery.setupDiscovery(1)).toMatch(/^[a-f0-9]{32}$/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('endpoint.json malformed'));
  });
});

describe('registerWithClaude (via registerOne)', () => {
  const claudeJson = path.join(HOME, '.claude.json');
  const TOKEN_HEX = 'a'.repeat(32);
  const URL = 'http://127.0.0.1:1/mcp';

  it('no-op when existing claude entry already matches url+token', () => {
    fs.existsSync.mockImplementation((p) => p === claudeJson);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: {
          'agent4live-ableton': {
            url: URL,
            headers: { Authorization: `Bearer ${TOKEN_HEX}` },
          },
        },
      }),
    );
    cp.execFileSync.mockReturnValue('claude\n');

    discovery.registerOne('claudeCode', URL, TOKEN_HEX);
    expect(uiState.agents.claudeCode.registered).toBe(true);
  });

  it('logs manual fallback when claude binary is not on the machine', () => {
    fs.existsSync.mockImplementation((p) => p === claudeJson);
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    discovery.registerOne('claudeCode', URL, TOKEN_HEX);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Auto-register skipped (claude not found)'),
    );
  });

  it('removes stale entry then adds, marks registered on success', () => {
    fs.existsSync.mockImplementation((p) => p === claudeJson);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: { 'agent4live-ableton': { url: 'http://stale/mcp' } },
      }),
    );
    cp.execFileSync.mockReturnValue('');
    discovery.registerOne('claudeCode', URL, TOKEN_HEX);
    expect(uiState.agents.claudeCode.registered).toBe(true);
    expect(log).toHaveBeenCalledWith('Auto-registered with Claude Code (with auth)');
  });

  it('logs failure with manual command when add throws (with err.code)', () => {
    fs.existsSync.mockReturnValue(false);
    let resolved = false;
    cp.execFileSync.mockImplementation(() => {
      if (!resolved) {
        resolved = true;
        return '';
      }
      const err = new Error('add failed');
      err.code = 'ETIMEDOUT';
      throw err;
    });
    discovery.registerOne('claudeCode', URL, TOKEN_HEX);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Auto-register failed (ETIMEDOUT)'));
  });

  it('treats unreadable claude.json as no-entry', () => {
    fs.existsSync.mockImplementation((p) => p === claudeJson);
    fs.readFileSync.mockReturnValue('{not-json');
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    discovery.registerOne('claudeCode', URL, TOKEN_HEX);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('~/.claude.json unreadable'));
  });

  it('falls back to err.message when no err.code on add failure', () => {
    fs.existsSync.mockReturnValue(false);
    let first = true;
    cp.execFileSync.mockImplementation(() => {
      if (first) {
        first = false;
        return '';
      }
      throw new Error('plain message');
    });
    discovery.registerOne('claudeCode', URL, TOKEN_HEX);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Auto-register failed (plain message)'),
    );
  });
});

describe('setupDiscovery (consent-free, persists endpoint.json only)', () => {
  it('does not auto-register Claude — only writes endpoint.json + returns token', () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.chmodSync.mockImplementation(() => {});
    cp.execFileSync.mockImplementation(() => {
      throw new Error('should not be called for register');
    });

    const token = discovery.setupDiscovery(8765);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    // No claude registration attempted.
    expect(uiState.agents.claudeCode.registered).toBe(false);
  });
});

describe('teardownDiscovery + unregister*', () => {
  it('runs all unregister paths and unlinks endpoint.json', async () => {
    cp.execFileSync.mockReturnValue('bin\n');
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      cb(null, '', '');
    });
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: { 'agent4live-ableton': {} } }));
    fs.writeFileSync.mockImplementation(() => {});
    fs.unlinkSync.mockImplementation(() => {});

    await discovery.teardownDiscovery();
    expect(fs.unlinkSync).toHaveBeenCalledWith(ENDPOINT_FILE);
    expect(uiState.agents.claudeCode.registered).toBe(false);
    expect(uiState.agents.codex.registered).toBe(false);
    expect(uiState.agents.gemini.registered).toBe(false);
    expect(uiState.agents.opencode.registered).toBe(false);
  });

  it('skips Claude/Codex/Gemini unregister when binary not found', async () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    fs.existsSync.mockReturnValue(false);
    fs.unlinkSync.mockImplementation(() => {
      throw new Error('no file');
    });

    await expect(discovery.teardownDiscovery()).resolves.toBeUndefined();
  });

  it('logs when each CLI unregister rejects', async () => {
    cp.execFileSync.mockReturnValue('bin\n');
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      cb(new Error('subprocess failed'), '', '');
    });
    fs.existsSync.mockReturnValue(false);
    fs.unlinkSync.mockImplementation(() => {});

    await discovery.teardownDiscovery();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('claude unregister failed (best-effort): subprocess failed'),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('codex unregister failed (best-effort): subprocess failed'),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('gemini unregister failed (best-effort): subprocess failed'),
    );
  });

  it('unregisterOpenCode no-ops when config file is missing', async () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    fs.existsSync.mockReturnValue(false);
    fs.unlinkSync.mockImplementation(() => {});
    await discovery.teardownDiscovery();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('unregisterOpenCode logs when config is unreadable', async () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    fs.unlinkSync.mockImplementation(() => {});
    await discovery.teardownDiscovery();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('opencode config unreadable on teardown'),
    );
  });

  it('unregisterOpenCode no-ops when our entry is not in config', async () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: {} }));
    fs.unlinkSync.mockImplementation(() => {});
    await discovery.teardownDiscovery();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('unregisterOpenCode logs on write failure', async () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: { 'agent4live-ableton': {} } }));
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    fs.unlinkSync.mockImplementation(() => {});
    await discovery.teardownDiscovery();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('opencode unregister failed: disk full'),
    );
  });
});

describe('setupConsentedClients gate', () => {
  it('skips agents without consent (no register call attempted)', async () => {
    const cpSpy = cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    fs.existsSync.mockReturnValue(false);
    await discovery.setupConsentedClients(
      { agents: { claudeCode: { consented: false }, codex: { consented: false } } },
      'http://x/mcp',
      'tok',
    );
    // resolveBin only called for opencode (first registerOpenCode call would have run if consented).
    // But all agents are not consented, so no call should happen at all.
    // However, even reading prefs.agents.* is OK. We just check no register* succeeded.
    expect(uiState.agents.claudeCode.registered).toBe(false);
    expect(uiState.agents.opencode.registered).toBe(false);
    expect(cpSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['mcp', 'add']),
      expect.anything(),
    );
  });

  it('handles null/undefined prefs gracefully', async () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    fs.existsSync.mockReturnValue(false);
    await expect(discovery.setupConsentedClients(null, 'x', 'y')).resolves.toBeUndefined();
    await expect(discovery.setupConsentedClients(undefined, 'x', 'y')).resolves.toBeUndefined();
    await expect(discovery.setupConsentedClients({}, 'x', 'y')).resolves.toBeUndefined();
  });
});

describe('registerOne dispatch', () => {
  it('claudeCode → registerWithClaude (sync, returns resolved promise)', async () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    await expect(
      discovery.registerOne('claudeCode', 'http://x/mcp', 'tok'),
    ).resolves.toBeUndefined();
  });

  it('opencode → registerOpenCode (sync, returns resolved promise)', async () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    await expect(discovery.registerOne('opencode', 'http://x/mcp', 'tok')).resolves.toBeUndefined();
  });

  it('codex → registerCodex with timeout wrap; rejection caught', async () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    await expect(discovery.registerOne('codex', 'http://x/mcp', 'tok')).resolves.toBeUndefined();
  });

  it('gemini → registerGemini with timeout wrap; rejection caught', async () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    await expect(discovery.registerOne('gemini', 'http://x/mcp', 'tok')).resolves.toBeUndefined();
  });

  it('throws on unknown agent', () => {
    expect(() => discovery.registerOne('evil', 'x', 'y')).toThrow(/unknown agent/);
  });

  it('codex timeout → catch logs, promise still resolves', async () => {
    jest.useFakeTimers();
    try {
      fs.existsSync.mockReturnValue(false);
      cp.execFileSync.mockImplementation((bin) => {
        if (String(bin).endsWith('/codex')) return 'codex\n';
        throw new Error('not found');
      });
      cp.execFile.mockImplementation(() => {});
      const p = discovery.registerOne('codex', 'http://x/mcp', 'tok');
      jest.advanceTimersByTime(11000);
      await expect(p).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('codex registration error'));
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('gemini timeout → catch logs, promise still resolves', async () => {
    jest.useFakeTimers();
    try {
      fs.existsSync.mockReturnValue(false);
      cp.execFileSync.mockImplementation((bin) => {
        if (String(bin).endsWith('/gemini')) return 'gemini\n';
        throw new Error('not found');
      });
      cp.execFile.mockImplementation(() => {});
      const p = discovery.registerOne('gemini', 'http://x/mcp', 'tok');
      jest.advanceTimersByTime(11000);
      await expect(p).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('gemini registration error'));
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('unregisterOne dispatch', () => {
  beforeEach(() => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    fs.existsSync.mockReturnValue(false);
  });

  it('claudeCode → unregisterFromClaude', async () => {
    await expect(discovery.unregisterOne('claudeCode')).resolves.toBeUndefined();
  });

  it('codex → unregisterCodex', async () => {
    await expect(discovery.unregisterOne('codex')).resolves.toBeUndefined();
  });

  it('gemini → unregisterGemini', async () => {
    await expect(discovery.unregisterOne('gemini')).resolves.toBeUndefined();
  });

  it('opencode → unregisterOpenCode (sync wrapped)', async () => {
    await expect(discovery.unregisterOne('opencode')).resolves.toBeUndefined();
  });

  it('throws on unknown agent', () => {
    expect(() => discovery.unregisterOne('evil')).toThrow(/unknown agent/);
  });
});

describe('installSkill / uninstallSkill', () => {
  const SKILL_FILE = path.join(HOME, '.claude', 'skills', 'agent4live', 'SKILL.md');
  const SKILL_DIR = path.join(HOME, '.claude', 'skills', 'agent4live');

  beforeEach(() => {
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.unlinkSync.mockImplementation(() => {});
    fs.rmdirSync.mockImplementation(() => {});
  });

  it('installSkill("claudeCode") writes SKILL.md with frontmatter + body', () => {
    discovery.installSkill('claudeCode');
    expect(fs.mkdirSync).toHaveBeenCalledWith(SKILL_DIR, { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [path_, body, encoding] = fs.writeFileSync.mock.calls[0];
    expect(path_).toBe(SKILL_FILE);
    expect(body.startsWith('---\nname: agent4live\n')).toBe(true);
    // Match the heading without hardcoding its full title — the guide's
    // wording evolves but its top heading always starts with "agent4live —".
    expect(body).toMatch(/# agent4live —/);
    expect(encoding).toBe('utf8');
  });

  it.each(['codex', 'gemini', 'opencode'])(
    'installSkill("%s") is a silent no-op (no fs writes)',
    (agent) => {
      discovery.installSkill(agent);
      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    },
  );

  it('installSkill logs a friendly error when the filesystem rejects the write', () => {
    fs.mkdirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    discovery.installSkill('claudeCode');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Skill install failed.*EACCES/));
  });

  it('uninstallSkill("claudeCode") unlinks SKILL.md then rmdir the parent', () => {
    discovery.uninstallSkill('claudeCode');
    expect(fs.unlinkSync).toHaveBeenCalledWith(SKILL_FILE);
    expect(fs.rmdirSync).toHaveBeenCalledWith(SKILL_DIR);
  });

  it.each(['codex', 'gemini', 'opencode'])('uninstallSkill("%s") is a silent no-op', (agent) => {
    discovery.uninstallSkill(agent);
    expect(fs.unlinkSync).not.toHaveBeenCalled();
    expect(fs.rmdirSync).not.toHaveBeenCalled();
  });

  it('uninstallSkill swallows unlink failure (file already gone)', () => {
    fs.unlinkSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(() => discovery.uninstallSkill('claudeCode')).not.toThrow();
    // Still attempts the rmdir afterwards.
    expect(fs.rmdirSync).toHaveBeenCalled();
  });

  it('uninstallSkill swallows rmdir failure (dir not empty)', () => {
    fs.rmdirSync.mockImplementation(() => {
      throw new Error('ENOTEMPTY');
    });
    expect(() => discovery.uninstallSkill('claudeCode')).not.toThrow();
  });

  it('registerOne(claudeCode) installs the skill alongside the MCP config', () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    discovery.registerOne('claudeCode', 'http://x/mcp', 'tok');
    expect(fs.writeFileSync).toHaveBeenCalledWith(SKILL_FILE, expect.any(String), 'utf8');
  });

  it('unregisterOne(claudeCode) removes the skill alongside the MCP config', async () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    await discovery.unregisterOne('claudeCode');
    expect(fs.unlinkSync).toHaveBeenCalledWith(SKILL_FILE);
  });

  it('setupConsentedClients installs the skill when claudeCode is consented', async () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    await discovery.setupConsentedClients(
      { agents: { claudeCode: { consented: true } } },
      'http://x/mcp',
      'tok',
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(SKILL_FILE, expect.any(String), 'utf8');
  });
});

describe('setupConsentedClients + register*', () => {
  it('registerOpenCode: skipped when binary not found', async () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 't');
    expect(log).toHaveBeenCalledWith('opencode not found');
  });

  it('registerOpenCode: writes new entry when no existing config', async () => {
    cp.execFileSync.mockImplementation((bin) => {
      if (String(bin).endsWith('/opencode')) return 'opencode\n';
      throw new Error('not found');
    });
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      OPENCODE_CONFIG,
      expect.stringContaining('"url": "http://x/mcp"'),
    );
    expect(uiState.agents.opencode.registered).toBe(true);
  });

  it('registerOpenCode: no-op when existing entry matches', async () => {
    cp.execFileSync.mockImplementation((bin) => {
      if (String(bin).endsWith('/opencode')) return 'opencode\n';
      throw new Error('not found');
    });
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        mcp: {
          'agent4live-ableton': {
            url: 'http://x/mcp',
            headers: { Authorization: 'Bearer tok' },
          },
        },
      }),
    );
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(OPENCODE_CONFIG, expect.anything());
    expect(uiState.agents.opencode.registered).toBe(true);
  });

  it('registerOpenCode: ignores non-object JSON, then overwrites', async () => {
    cp.execFileSync.mockImplementation((bin) => {
      if (String(bin).endsWith('/opencode')) return 'opencode\n';
      throw new Error('not found');
    });
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue(JSON.stringify(['array']));
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('registerOpenCode: logs when JSON is malformed', async () => {
    cp.execFileSync.mockImplementation((bin) => {
      if (String(bin).endsWith('/opencode')) return 'opencode\n';
      throw new Error('not found');
    });
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue('not-json');
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('opencode config unreadable'));
  });

  it('registerOpenCode: logs when write fails', async () => {
    cp.execFileSync.mockImplementation((bin) => {
      if (String(bin).endsWith('/opencode')) return 'opencode\n';
      throw new Error('not found');
    });
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('opencode config write failed: disk full'),
    );
  });
});

describe('registerCodex / registerGemini', () => {
  beforeEach(() => {
    fs.existsSync.mockReturnValue(false);
  });

  function execFileBin(target) {
    cp.execFileSync.mockImplementation((bin) => {
      if (String(bin).includes(target)) return `${target}\n`;
      throw new Error('not found');
    });
  }

  it('codex: no-op when bin missing — logs "codex not found"', async () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    await new Promise((r) => setImmediate(r));
    expect(log).toHaveBeenCalledWith('codex not found');
    expect(log).toHaveBeenCalledWith('gemini not found');
  });

  it('codex: keeps existing entry when "mcp list" includes SERVER_NAME', async () => {
    execFileBin('codex');
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      cb(null, 'agent4live-ableton  http://...', '');
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(uiState.agents.codex.registered).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('codex: already registered'));
  });

  it('codex: list throws then add succeeds → registered', async () => {
    execFileBin('codex');
    let call = 0;
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      call++;
      if (call === 1) cb(new Error('list failed'), '', '');
      else cb(null, '', '');
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(uiState.agents.codex.registered).toBe(true);
    expect(log).toHaveBeenCalledWith('codex: registered (with auth)');
  });

  it('codex: add throws → logs manual fallback', async () => {
    execFileBin('codex');
    let call = 0;
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      call++;
      if (call === 1) cb(null, 'no entry', '');
      else cb(new Error('add boom'), '', '');
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('codex mcp add failed'));
  });

  it('gemini: list contains SERVER_NAME → already registered', async () => {
    execFileBin('gemini');
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      cb(null, 'agent4live-ableton  http://...', '');
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(uiState.agents.gemini.registered).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('gemini: already registered'));
  });

  it('gemini: list throws then add succeeds', async () => {
    execFileBin('gemini');
    let call = 0;
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      call++;
      if (call === 1) cb(new Error('boom'), '', '');
      else cb(null, '', '');
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(uiState.agents.gemini.registered).toBe(true);
  });

  it('gemini: add throws → logs manual fallback', async () => {
    execFileBin('gemini');
    let call = 0;
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      call++;
      if (call === 1) cb(null, 'no entry', '');
      else cb(new Error('add fail'), '', '');
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('gemini mcp add failed'));
  });
});

describe('resolveBin shell fallback', () => {
  it('finds bin via login shell when direct candidates fail', () => {
    let calls = 0;
    cp.execFileSync.mockImplementation((bin, args) => {
      calls++;
      if (calls <= 8) throw new Error('not found');
      if (Array.isArray(args) && args[0] === '-lc') return '/usr/bin/myclaude\n';
      return 'claude\n';
    });
    discovery.detectClaude();
    expect(uiState.agents.claudeCode.detected).toBe(true);
  });

  it('shell fallback returning relative path is rejected', () => {
    let calls = 0;
    cp.execFileSync.mockImplementation((bin, args) => {
      calls++;
      if (calls <= 8) throw new Error('not found');
      if (Array.isArray(args) && args[0] === '-lc') return 'relative-path\n';
      throw new Error('never reached');
    });
    discovery.detectClaude();
    expect(uiState.agents.claudeCode.detected).toBe(false);
  });

  it('shell fallback with custom $SHELL', () => {
    const prev = process.env.SHELL;
    process.env.SHELL = '/bin/bash';
    try {
      let calls = 0;
      cp.execFileSync.mockImplementation((bin) => {
        calls++;
        if (calls <= 8) throw new Error('not found');
        if (bin === '/bin/bash') return '/x/y/claude\n';
        return 'claude\n';
      });
      discovery.detectClaude();
      expect(uiState.agents.claudeCode.detected).toBe(true);
    } finally {
      process.env.SHELL = prev;
    }
  });

  it('falls back to /bin/zsh when SHELL is unset', () => {
    const prev = process.env.SHELL;
    delete process.env.SHELL;
    try {
      let calls = 0;
      cp.execFileSync.mockImplementation((bin) => {
        calls++;
        if (calls <= 8) throw new Error('not found');
        if (bin === '/bin/zsh') return '/x/y/claude\n';
        return 'claude\n';
      });
      discovery.detectClaude();
      expect(uiState.agents.claudeCode.detected).toBe(true);
    } finally {
      if (prev !== undefined) process.env.SHELL = prev;
    }
  });
});

describe('withRegistrationTimeout (via slow registerCodex)', () => {
  beforeEach(() => {
    fs.existsSync.mockReturnValue(false);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('rejects with timeout when registration hangs longer than budget (codex)', async () => {
    cp.execFileSync.mockImplementation((bin) => {
      if (String(bin).endsWith('/codex')) return 'codex\n';
      throw new Error('not found');
    });
    cp.execFile.mockImplementation(() => {});
    discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    jest.advanceTimersByTime(11000);
    // Drain microtasks: race + .finally + .catch each add a microtask hop.
    for (let i = 0; i < 6; i++) await Promise.resolve();
    // Run any remaining fake timers (clearTimeout in finally is queued as a
    // microtask that the fake clock processes lazily).
    jest.runOnlyPendingTimers();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('codex registration error: codex registration timed out after 10s'),
    );
  });

  it('rejects with timeout when registration hangs longer than budget (gemini)', async () => {
    cp.execFileSync.mockImplementation((bin) => {
      if (String(bin).endsWith('/gemini')) return 'gemini\n';
      throw new Error('not found');
    });
    cp.execFile.mockImplementation(() => {});
    discovery.setupConsentedClients(ALL_CONSENTED, 'http://x/mcp', 'tok');
    jest.advanceTimersByTime(11000);
    // Drain microtasks: race + .finally + .catch each add a microtask hop.
    for (let i = 0; i < 6; i++) await Promise.resolve();
    // Run any remaining fake timers (clearTimeout in finally is queued as a
    // microtask that the fake clock processes lazily).
    jest.runOnlyPendingTimers();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('gemini registration error: gemini registration timed out after 10s'),
    );
  });
});

describe('registerOpenCode preserves existing $schema and mcp keys', () => {
  it('overwrites just the agent4live entry without recreating $schema or mcp', async () => {
    cp.execFileSync.mockImplementation((bin) => {
      if (String(bin).endsWith('/opencode')) return 'opencode\n';
      throw new Error('not found');
    });
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          'other-server': { url: 'http://other' },
          'agent4live-ableton': { url: 'http://stale/mcp' },
        },
      }),
    );
    fs.mkdirSync.mockImplementation(() => {});
    let written;
    fs.writeFileSync.mockImplementation((_, body) => {
      written = body;
    });
    await discovery.setupConsentedClients(ALL_CONSENTED, 'http://fresh/mcp', 'tok');
    expect(fs.writeFileSync).toHaveBeenCalled();
    const parsed = JSON.parse(written);
    expect(parsed.$schema).toBe('https://opencode.ai/config.json');
    expect(parsed.mcp['other-server']).toEqual({ url: 'http://other' });
    expect(parsed.mcp['agent4live-ableton'].url).toBe('http://fresh/mcp');
  });
});
