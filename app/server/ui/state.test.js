'use strict';

// Tests for state.js — pure-logic helpers (pad2, uiLog rotation, XSS-safe
// HTML rendering, log file IO, uiRender edge transitions). max-api comes
// from tools/test/max-api-stub.js ; .html requires are handled by the
// transformer in jest.config.js.

const fs = require('node:fs');
const Max = require('max-api');

jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
jest.spyOn(fs, 'appendFileSync').mockImplementation(() => undefined);
jest.spyOn(Max, 'post').mockImplementation(() => undefined);
jest.spyOn(Max, 'outlet').mockImplementation(() => Promise.resolve());

const {
  pad2,
  uiLog,
  uiState,
  log,
  uiRender,
  buildUiHtml,
  buildPassiveUiHtml,
  emitLoadingUi,
} = require('./state');
const { MAX_UI_LOGS } = require('../config');

describe('pad2', () => {
  it('zero-pads single digits', () => {
    expect(pad2(0)).toBe('00');
    expect(pad2(5)).toBe('05');
    expect(pad2(9)).toBe('09');
  });

  it('leaves two-digit numbers unchanged', () => {
    expect(pad2(10)).toBe('10');
    expect(pad2(42)).toBe('42');
    expect(pad2(99)).toBe('99');
  });
});

describe('uiLog', () => {
  beforeEach(() => {
    uiState.logs = [];
  });

  it('appends entries to uiState.logs', () => {
    uiLog('set_tempo(120)', false);
    uiLog('fire_clip(0,0)', false);
    expect(uiState.logs).toHaveLength(2);
    expect(uiState.logs[0].tool).toBe('set_tempo(120)');
    expect(uiState.logs[0].result).toBe('ok');
    expect(uiState.logs[0].isError).toBe(false);
    expect(uiState.logs[1].tool).toBe('fire_clip(0,0)');
    expect(uiState.logs[0].ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('flags errors with result=error', () => {
    uiLog('failing_tool', true);
    expect(uiState.logs[0].result).toBe('error');
    expect(uiState.logs[0].isError).toBe(true);
  });

  it('rotates FIFO at MAX_UI_LOGS entries', () => {
    for (let index = 0; index < MAX_UI_LOGS + 10; index += 1) {
      uiLog(`call_${index}`, false);
    }
    expect(uiState.logs).toHaveLength(MAX_UI_LOGS);
    // Oldest entries dropped: first kept = call_10 (10 dropped from front).
    expect(uiState.logs[0].tool).toBe('call_10');
    expect(uiState.logs[uiState.logs.length - 1].tool).toBe(`call_${MAX_UI_LOGS + 9}`);
  });
});

describe('buildPassiveUiHtml', () => {
  it('escapes XSS-dangerous chars in the track name', () => {
    const html = buildPassiveUiHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes ampersands and quotes', () => {
    const html = buildPassiveUiHtml(`A&B"'C`);
    expect(html).toContain('A&amp;B&quot;&#39;C');
  });

  it('falls back to default text when name is null', () => {
    const html = buildPassiveUiHtml(null);
    expect(html).toContain('elsewhere in this Set');
  });
});

describe('buildUiHtml', () => {
  it('returns the active-mode HTML (non-empty string)', () => {
    expect(typeof buildUiHtml()).toBe('string');
    expect(buildUiHtml().length).toBeGreaterThan(0);
  });
});

describe('log', () => {
  beforeEach(() => {
    fs.mkdirSync.mockClear();
    fs.appendFileSync.mockClear();
    Max.post.mockClear();
  });

  it('appends a timestamped + pid-prefixed line to the runtime log file', () => {
    log('hello');
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    const written = fs.appendFileSync.mock.calls[0][1];
    expect(written).toMatch(/\[\d{4}-\d{2}-\d{2}T.*\] \[pid=\d+\] hello\n$/);
  });

  it('also posts the [MCP]-prefixed message to Max console', () => {
    log('boot');
    expect(Max.post).toHaveBeenCalledWith('[MCP] boot');
  });

  it('swallows filesystem errors silently (logging must not crash)', () => {
    fs.mkdirSync.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => log('still posts')).not.toThrow();
    expect(Max.post).toHaveBeenCalledWith('[MCP] still posts');
  });
});

describe('uiRender', () => {
  beforeEach(() => {
    Max.outlet.mockClear();
    // Reset internal uiPageLoaded flag by toggling connected off then back on.
    uiState.connected = false;
    uiRender(); // disconnect (idempotent)
  });

  it('emits a ui_status URL the first time `connected` becomes true', () => {
    uiState.connected = true;
    uiRender();
    expect(Max.outlet).toHaveBeenCalledTimes(1);
    expect(Max.outlet).toHaveBeenCalledWith(
      'ui_status',
      'url',
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/ui$/),
    );
  });

  it('is idempotent when called twice with `connected` still true', () => {
    uiState.connected = true;
    uiRender();
    uiRender();
    expect(Max.outlet).toHaveBeenCalledTimes(1);
  });

  it('resets the page-loaded flag when connected flips back to false', () => {
    uiState.connected = true;
    uiRender(); // emit (1 outlet call)
    uiState.connected = false;
    uiRender(); // reset internal state, no outlet
    uiState.connected = true;
    uiRender(); // re-emit (2nd outlet call)
    expect(Max.outlet).toHaveBeenCalledTimes(2);
  });

  it("survives Max.outlet rejecting (best-effort, doesn't crash uiRender)", () => {
    Max.outlet.mockReturnValueOnce(Promise.reject(new Error('outlet pipe closed')));
    uiState.connected = true;
    expect(() => uiRender()).not.toThrow();
  });
});

describe('emitLoadingUi', () => {
  beforeEach(() => Max.outlet.mockClear());

  it('emits a base64-encoded "Loading..." data URL', () => {
    emitLoadingUi();
    expect(Max.outlet).toHaveBeenCalledTimes(1);
    const [outletName, kind, dataUrl] = Max.outlet.mock.calls[0];
    expect(outletName).toBe('ui_status');
    expect(kind).toBe('url');
    expect(dataUrl).toMatch(/^data:text\/html;base64,/);
    const decoded = Buffer.from(dataUrl.replace('data:text/html;base64,', ''), 'base64').toString(
      'utf8',
    );
    expect(decoded).toContain('Loading...');
  });

  it("survives Max.outlet rejecting (best-effort, doesn't crash boot)", () => {
    Max.outlet.mockReturnValueOnce(Promise.reject(new Error('outlet pipe closed')));
    expect(() => emitLoadingUi()).not.toThrow();
  });
});
