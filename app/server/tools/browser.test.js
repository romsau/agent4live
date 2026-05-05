'use strict';

// Tests for the browser tool family. The Python companion is mocked at the
// helper level so we never touch a real socket.

jest.mock('../python', () => ({
  isAlive: jest.fn(),
  browserList: jest.fn(),
  browserLoadItem: jest.fn(),
  browserSearch: jest.fn(),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const python = require('../python');
const family = require('./browser');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  jest.clearAllMocks();
});

it('every tool has a non-empty description', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(40);
});

it('registers the 3 browser tools', () => {
  expect(tools.map((t) => t.name)).toEqual([
    'browser_list_items',
    'browser_load_item',
    'browser_search',
  ]);
});

describe('companion gate', () => {
  it('throws a friendly error when the companion is not reachable', async () => {
    python.isAlive.mockResolvedValue(false);
    await expect(
      callHandlerText(byName('browser_list_items').handler, { path: '' }),
    ).rejects.toThrow(/requires the agent4live Python companion/);
  });
});

describe('browser_list_items', () => {
  it('forwards path to browserList and returns the JSON items', async () => {
    python.isAlive.mockResolvedValue(true);
    python.browserList.mockResolvedValue({
      ok: true,
      items: [{ name: 'Drum Rack', uri: 'u1', is_folder: true, is_loadable: false }],
    });
    const text = await callHandlerText(byName('browser_list_items').handler, {
      path: 'instruments',
    });
    expect(python.browserList).toHaveBeenCalledWith('instruments');
    expect(JSON.parse(text)).toEqual([
      { name: 'Drum Rack', uri: 'u1', is_folder: true, is_loadable: false },
    ]);
  });

  it('surfaces the companion error when ok=false', async () => {
    python.isAlive.mockResolvedValue(true);
    python.browserList.mockResolvedValue({ ok: false, error: 'unknown root: foo' });
    await expect(
      callHandlerText(byName('browser_list_items').handler, { path: 'foo' }),
    ).rejects.toThrow(/unknown root: foo/);
  });

  it('falls back to a generic error when ok=false has no error field', async () => {
    python.isAlive.mockResolvedValue(true);
    python.browserList.mockResolvedValue({ ok: false });
    await expect(
      callHandlerText(byName('browser_list_items').handler, { path: '' }),
    ).rejects.toThrow(/companion returned an error/);
  });
});

describe('browser_load_item', () => {
  it('forwards path and returns the loaded item name', async () => {
    python.isAlive.mockResolvedValue(true);
    python.browserLoadItem.mockResolvedValue({ ok: true, loaded: 'Kick 1' });
    const text = await callHandlerText(byName('browser_load_item').handler, {
      path: '/drums/Kick 1.adv',
    });
    expect(python.browserLoadItem).toHaveBeenCalledWith('/drums/Kick 1.adv');
    expect(text).toBe('Loaded Kick 1');
  });

  it('surfaces "item is not loadable" errors', async () => {
    python.isAlive.mockResolvedValue(true);
    python.browserLoadItem.mockResolvedValue({ ok: false, error: 'item is not loadable: Foo' });
    await expect(
      callHandlerText(byName('browser_load_item').handler, { path: '/drums/Foo' }),
    ).rejects.toThrow(/not loadable/);
  });
});

describe('browser_search', () => {
  it('forwards query/root/limit and returns JSON', async () => {
    python.isAlive.mockResolvedValue(true);
    python.browserSearch.mockResolvedValue({
      ok: true,
      results: [{ name: 'Kick 808', uri: 'u8', path: '/Drums/808', is_loadable: true }],
      truncated: false,
    });
    const text = await callHandlerText(byName('browser_search').handler, {
      query: 'kick',
      root: 'drums',
      limit: 25,
    });
    expect(python.browserSearch).toHaveBeenCalledWith('kick', 'drums', 25);
    const parsed = JSON.parse(text);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.truncated).toBe(false);
  });

  it('surfaces a missing-query error from the companion', async () => {
    python.isAlive.mockResolvedValue(true);
    python.browserSearch.mockResolvedValue({ ok: false, error: 'missing query' });
    await expect(
      callHandlerText(byName('browser_search').handler, { query: 'x', root: '', limit: 50 }),
    ).rejects.toThrow(/missing query/);
  });
});
