'use strict';

jest.mock('fs');
jest.mock('../config', () => ({ SERVER_NAME: 'agent4live-ableton' }));

const fs = require('fs');
const path = require('path');
const os = require('os');
const prefsMod = require('./preferences');

const HOME = os.homedir();
const PREFERENCES_FILE = path.join(HOME, '.agent4live-ableton-mcp', 'preferences.json');
const CLAUDE_CONFIG = path.join(HOME, '.claude.json');
const OPENCODE_CONFIG = path.join(HOME, '.config', 'opencode', 'opencode.json');
const GEMINI_CONFIG = path.join(HOME, '.gemini', 'settings.json');
const CODEX_CONFIG = path.join(HOME, '.codex', 'config.toml');

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.AGENT4LIVE_AUTO_REGISTER;
});

afterEach(() => {
  delete process.env.AGENT4LIVE_AUTO_REGISTER;
});

describe('defaultPreferences', () => {
  it('returns version 1 + empty agents map', () => {
    expect(prefsMod.defaultPreferences()).toEqual({ version: 1, agents: {} });
  });
});

describe('loadPreferences', () => {
  it('returns null when file is missing', () => {
    fs.existsSync.mockReturnValue(false);
    expect(prefsMod.loadPreferences()).toBeNull();
  });

  it('returns parsed object when file is valid', () => {
    const data = { version: 1, agents: { claudeCode: { consented: true } } };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(data));
    expect(prefsMod.loadPreferences()).toEqual(data);
  });

  it('returns null on JSON parse error', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{not-json');
    expect(prefsMod.loadPreferences()).toBeNull();
  });

  it('returns null when parsed is not an object', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('null');
    expect(prefsMod.loadPreferences()).toBeNull();
  });

  it('returns null when parsed is an array', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('[]');
    expect(prefsMod.loadPreferences()).toBeNull();
  });

  it('returns null when agents key is missing', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ version: 1 }));
    expect(prefsMod.loadPreferences()).toBeNull();
  });

  it('returns null when agents is not an object', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ version: 1, agents: 'oops' }));
    expect(prefsMod.loadPreferences()).toBeNull();
  });
});

describe('savePreferences', () => {
  beforeEach(() => {
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.chmodSync.mockImplementation(() => {});
  });

  it('writes prettified JSON with chmod 600', () => {
    const data = { version: 1, agents: { claudeCode: { consented: true } } };
    prefsMod.savePreferences(data);
    expect(fs.writeFileSync).toHaveBeenCalledWith(PREFERENCES_FILE, JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
    expect(fs.chmodSync).toHaveBeenCalledWith(PREFERENCES_FILE, 0o600);
  });

  it('creates the parent directory if missing', () => {
    prefsMod.savePreferences({ version: 1, agents: {} });
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('agent4live-ableton-mcp'), {
      recursive: true,
    });
  });

  it('swallows chmod failures (best-effort)', () => {
    fs.chmodSync.mockImplementation(() => {
      throw new Error('chmod boom');
    });
    expect(() => prefsMod.savePreferences({ version: 1, agents: {} })).not.toThrow();
  });
});

describe('markConsent', () => {
  it('records consented=true with ISO timestamp + url', () => {
    const p = { agents: {} };
    prefsMod.markConsent(p, 'claudeCode', true, 'http://x/mcp');
    expect(p.agents.claudeCode.consented).toBe(true);
    expect(p.agents.claudeCode.url_at_consent).toBe('http://x/mcp');
    expect(p.agents.claudeCode.consented_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records consented=false without metadata, even if previously consented', () => {
    const p = {
      agents: {
        claudeCode: { consented: true, consented_at: 'old', url_at_consent: 'http://old' },
      },
    };
    prefsMod.markConsent(p, 'claudeCode', false);
    expect(p.agents.claudeCode).toEqual({ consented: false });
  });

  it('initializes agents if missing on the prefs object', () => {
    const p = {};
    prefsMod.markConsent(p, 'codex', true, 'http://x/mcp');
    expect(p.agents.codex.consented).toBe(true);
  });

  it('throws on unknown agent', () => {
    expect(() => prefsMod.markConsent({ agents: {} }, 'evil', true, 'x')).toThrow(/unknown agent/);
  });

  it('handles all four official agents', () => {
    for (const agent of ['claudeCode', 'codex', 'gemini', 'opencode']) {
      const p = { agents: {} };
      expect(() => prefsMod.markConsent(p, agent, true, 'http://x')).not.toThrow();
      expect(p.agents[agent].consented).toBe(true);
    }
  });
});

describe('isFirstBoot', () => {
  it('returns true when prefs is null', () => {
    expect(prefsMod.isFirstBoot(null)).toBe(true);
  });

  it('returns true when prefs is undefined', () => {
    expect(prefsMod.isFirstBoot(undefined)).toBe(true);
  });

  it('returns true when prefs has no agents key', () => {
    expect(prefsMod.isFirstBoot({})).toBe(true);
  });

  it('returns true when agents map is empty', () => {
    expect(prefsMod.isFirstBoot({ agents: {} })).toBe(true);
  });

  it('returns false when at least one agent is recorded', () => {
    expect(prefsMod.isFirstBoot({ agents: { codex: { consented: false } } })).toBe(false);
  });
});

describe('migrateFromExistingConfigs', () => {
  it('detects existing Claude registration with localhost URL', () => {
    fs.existsSync.mockImplementation((p) => p === CLAUDE_CONFIG);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: { 'agent4live-ableton': { url: 'http://127.0.0.1:19845/mcp' } },
      }),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({ claudeCode: true });
  });

  it('detects existing OpenCode registration with localhost URL', () => {
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        mcp: { 'agent4live-ableton': { url: 'http://localhost:19845/mcp' } },
      }),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({ opencode: true });
  });

  it('detects all four when all four are present', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation((p) => {
      if (p === CLAUDE_CONFIG) {
        return JSON.stringify({
          mcpServers: { 'agent4live-ableton': { url: 'http://127.0.0.1:1/mcp' } },
        });
      }
      if (p === OPENCODE_CONFIG) {
        return JSON.stringify({
          mcp: { 'agent4live-ableton': { url: 'http://127.0.0.1:1/mcp' } },
        });
      }
      if (p === GEMINI_CONFIG) {
        return JSON.stringify({
          mcpServers: { 'agent4live-ableton': { httpUrl: 'http://127.0.0.1:1/mcp' } },
        });
      }
      if (p === CODEX_CONFIG) {
        return '[mcp_servers.agent4live-ableton]\nurl = "http://127.0.0.1:1/mcp"\n';
      }
      return '{}';
    });
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({
      claudeCode: true,
      opencode: true,
      gemini: true,
      codex: true,
    });
  });

  it('detects existing Gemini registration with localhost httpUrl', () => {
    fs.existsSync.mockImplementation((p) => p === GEMINI_CONFIG);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: { 'agent4live-ableton': { httpUrl: 'http://localhost:19845/mcp' } },
      }),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({ gemini: true });
  });

  it('ignores Gemini entry without httpUrl field', () => {
    fs.existsSync.mockImplementation((p) => p === GEMINI_CONFIG);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mcpServers: { 'agent4live-ableton': {} } }));
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores Gemini entry with non-localhost httpUrl', () => {
    fs.existsSync.mockImplementation((p) => p === GEMINI_CONFIG);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: { 'agent4live-ableton': { httpUrl: 'https://evil.com/mcp' } },
      }),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores Gemini entry where url field is used (Gemini expects httpUrl)', () => {
    fs.existsSync.mockImplementation((p) => p === GEMINI_CONFIG);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: { 'agent4live-ableton': { url: 'http://127.0.0.1:19845/mcp' } },
      }),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('detects existing Codex registration with localhost url in TOML section', () => {
    fs.existsSync.mockImplementation((p) => p === CODEX_CONFIG);
    fs.readFileSync.mockReturnValue(
      [
        '[mcp_servers.agent4live-ableton]',
        'url = "http://127.0.0.1:19845/mcp"',
        'bearer_token_env_var = "AGENT4LIVE_TOKEN"',
        '',
      ].join('\n'),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({ codex: true });
  });

  it('ignores Codex section with non-localhost url', () => {
    fs.existsSync.mockImplementation((p) => p === CODEX_CONFIG);
    fs.readFileSync.mockReturnValue(
      ['[mcp_servers.agent4live-ableton]', 'url = "https://evil.com/mcp"', ''].join('\n'),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores Codex file when our section is missing', () => {
    fs.existsSync.mockImplementation((p) => p === CODEX_CONFIG);
    fs.readFileSync.mockReturnValue(
      ['[mcp_servers.figma]', 'url = "https://mcp.figma.com/mcp"', ''].join('\n'),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores Codex section without a url field', () => {
    fs.existsSync.mockImplementation((p) => p === CODEX_CONFIG);
    fs.readFileSync.mockReturnValue(
      ['[mcp_servers.agent4live-ableton]', 'bearer_token_env_var = "X"', ''].join('\n'),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores Codex url that lives in another section (only ours counts)', () => {
    fs.existsSync.mockImplementation((p) => p === CODEX_CONFIG);
    fs.readFileSync.mockReturnValue(
      [
        '[mcp_servers.someone-else]',
        'url = "http://127.0.0.1:9999/mcp"',
        '',
        '[mcp_servers.agent4live-ableton]',
        'bearer_token_env_var = "X"',
        '',
      ].join('\n'),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('handles malformed Codex TOML silently', () => {
    fs.existsSync.mockImplementation((p) => p === CODEX_CONFIG);
    fs.readFileSync.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores non-localhost URL (defense against migration of remote entry)', () => {
    fs.existsSync.mockImplementation((p) => p === CLAUDE_CONFIG);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        mcpServers: { 'agent4live-ableton': { url: 'https://evil.com/mcp' } },
      }),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores entry without url field', () => {
    fs.existsSync.mockImplementation((p) => p === CLAUDE_CONFIG);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mcpServers: { 'agent4live-ableton': {} } }));
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores OpenCode entry without url field', () => {
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: { 'agent4live-ableton': {} } }));
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores OpenCode entry with non-localhost url', () => {
    fs.existsSync.mockImplementation((p) => p === OPENCODE_CONFIG);
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ mcp: { 'agent4live-ableton': { url: 'https://evil.com' } } }),
    );
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('ignores missing entry', () => {
    fs.existsSync.mockImplementation((p) => p === CLAUDE_CONFIG);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mcpServers: {} }));
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('handles malformed JSON silently for both Claude and OpenCode', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{not-json');
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });

  it('returns empty object when no config files exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(prefsMod.migrateFromExistingConfigs()).toEqual({});
  });
});

describe('applyAutoRegisterEnv', () => {
  it('no-op when AGENT4LIVE_AUTO_REGISTER is unset', () => {
    const p = { agents: {} };
    prefsMod.applyAutoRegisterEnv(p, 'http://x/mcp');
    expect(p.agents).toEqual({});
  });

  it('marks listed agents consented (comma-separated)', () => {
    process.env.AGENT4LIVE_AUTO_REGISTER = 'claude,codex,gemini,opencode';
    const p = { agents: {} };
    prefsMod.applyAutoRegisterEnv(p, 'http://x/mcp');
    expect(p.agents.claudeCode.consented).toBe(true);
    expect(p.agents.codex.consented).toBe(true);
    expect(p.agents.gemini.consented).toBe(true);
    expect(p.agents.opencode.consented).toBe(true);
  });

  it('accepts mixed case + whitespace', () => {
    process.env.AGENT4LIVE_AUTO_REGISTER = ' Claude , CODEX ';
    const p = { agents: {} };
    prefsMod.applyAutoRegisterEnv(p, 'http://x/mcp');
    expect(p.agents.claudeCode.consented).toBe(true);
    expect(p.agents.codex.consented).toBe(true);
    expect(p.agents.gemini).toBeUndefined();
  });

  it('accepts the internal claudeCode alias too', () => {
    process.env.AGENT4LIVE_AUTO_REGISTER = 'claudeCode';
    const p = { agents: {} };
    prefsMod.applyAutoRegisterEnv(p, 'http://x/mcp');
    expect(p.agents.claudeCode.consented).toBe(true);
  });

  it('ignores unknown tokens silently', () => {
    process.env.AGENT4LIVE_AUTO_REGISTER = 'evil,malware,fake-cli';
    const p = { agents: {} };
    prefsMod.applyAutoRegisterEnv(p, 'http://x/mcp');
    expect(p.agents).toEqual({});
  });

  it('records the URL at consent time', () => {
    process.env.AGENT4LIVE_AUTO_REGISTER = 'claude';
    const p = { agents: {} };
    prefsMod.applyAutoRegisterEnv(p, 'http://127.0.0.1:19845/mcp');
    expect(p.agents.claudeCode.url_at_consent).toBe('http://127.0.0.1:19845/mcp');
  });
});

describe('_extractCodexUrl', () => {
  it('returns the url from the matching section', () => {
    const toml = '[mcp_servers.agent4live-ableton]\nurl = "http://127.0.0.1:1/mcp"\n';
    expect(prefsMod._extractCodexUrl(toml, 'agent4live-ableton')).toBe('http://127.0.0.1:1/mcp');
  });

  it('returns null when the section is missing', () => {
    const toml = '[mcp_servers.figma]\nurl = "https://mcp.figma.com/mcp"\n';
    expect(prefsMod._extractCodexUrl(toml, 'agent4live-ableton')).toBeNull();
  });

  it('returns null when the matching section has no url key', () => {
    const toml = '[mcp_servers.agent4live-ableton]\nbearer_token_env_var = "X"\n';
    expect(prefsMod._extractCodexUrl(toml, 'agent4live-ableton')).toBeNull();
  });

  it('stops at the next section header (no leak across sections)', () => {
    const toml = [
      '[mcp_servers.agent4live-ableton]',
      'bearer_token_env_var = "X"',
      '[mcp_servers.figma]',
      'url = "https://mcp.figma.com/mcp"',
    ].join('\n');
    expect(prefsMod._extractCodexUrl(toml, 'agent4live-ableton')).toBeNull();
  });

  it('skips comment lines and blank lines', () => {
    const toml = [
      '# comment',
      '',
      '[mcp_servers.agent4live-ableton]',
      '# inline comment',
      '',
      'url = "http://127.0.0.1:1/mcp"',
    ].join('\n');
    expect(prefsMod._extractCodexUrl(toml, 'agent4live-ableton')).toBe('http://127.0.0.1:1/mcp');
  });

  it('tolerates extra whitespace around the equals sign', () => {
    const toml = '[mcp_servers.agent4live-ableton]\nurl    =   "http://127.0.0.1:1/mcp"\n';
    expect(prefsMod._extractCodexUrl(toml, 'agent4live-ableton')).toBe('http://127.0.0.1:1/mcp');
  });

  it('handles CRLF line endings (Windows)', () => {
    const toml = '[mcp_servers.agent4live-ableton]\r\nurl = "http://127.0.0.1:1/mcp"\r\n';
    expect(prefsMod._extractCodexUrl(toml, 'agent4live-ableton')).toBe('http://127.0.0.1:1/mcp');
  });

  it('returns null on empty input', () => {
    expect(prefsMod._extractCodexUrl('', 'agent4live-ableton')).toBeNull();
  });
});

describe('_isLocalhostUrl', () => {
  it.each([
    ['http://127.0.0.1/mcp', true],
    ['http://127.0.0.1:19845/mcp', true],
    ['https://127.0.0.1:19845/mcp', true],
    ['http://localhost/mcp', true],
    ['http://localhost:19845/mcp', true],
    ['http://localhost', true],
    ['http://127.0.0.1', true],
    ['https://evil.com/mcp', false],
    ['http://10.0.0.5:19845/mcp', false],
    ['http://example.com/127.0.0.1/mcp', false],
    ['ftp://127.0.0.1/mcp', false],
    ['', false],
  ])('isLocalhostUrl(%s) = %s', (url, expected) => {
    expect(prefsMod._isLocalhostUrl(url)).toBe(expected);
  });
});
