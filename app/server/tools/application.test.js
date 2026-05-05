'use strict';

jest.mock('../lom', () => ({
  lomGet: jest.fn(),
  lomCall: jest.fn(),
  lomGetControlSurfaces: jest.fn(() => Promise.resolve('[{"index":0,"type_name":"None"}]')),
  lomGetControlSurfaceControls: jest.fn(() => Promise.resolve('["Play_Button"]')),
}));
jest.mock('../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../tools/test/tool-test-utils');
const lom = require('../lom');
const family = require('./application');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);

beforeEach(() => {
  jest.clearAllMocks();
});

it('registers control-surface + view + dialog tools', () => {
  expect(tools.map((t) => t.name)).toEqual([
    'get_control_surfaces',
    'get_control_surface_controls',
    'get_view_state',
    'get_available_views',
    'focus_view',
    'show_view',
    'hide_view',
    'is_view_visible',
    'scroll_view',
    'zoom_view',
    'toggle_browse',
    'get_dialog_state',
    'press_dialog_button',
  ]);
  for (const t of tools) expect(t.description.length).toBeGreaterThan(20);
});

// ── Control surfaces ────────────────────────────────────────────────────
it('get_control_surfaces returns the JSON from the LOM helper', async () => {
  const text = await callHandlerText(byName('get_control_surfaces').handler);
  expect(lom.lomGetControlSurfaces).toHaveBeenCalled();
  expect(text).toBe('[{"index":0,"type_name":"None"}]');
});

it('get_control_surface_controls forwards surface_index and returns JSON', async () => {
  const text = await callHandlerText(byName('get_control_surface_controls').handler, {
    surface_index: 2,
  });
  expect(lom.lomGetControlSurfaceControls).toHaveBeenCalledWith(2);
  expect(text).toBe('["Play_Button"]');
});

// ── View ────────────────────────────────────────────────────────────────
it('get_view_state aggregates browse_mode + focused_document_view', async () => {
  lom.lomGet.mockResolvedValueOnce(1).mockResolvedValueOnce('Session');
  const text = await callHandlerText(byName('get_view_state').handler);
  expect(JSON.parse(text)).toEqual({ browse_mode: true, focused_document_view: 'Session' });
  // Both reads target the same canonical path.
  for (const c of lom.lomGet.mock.calls) expect(c[0]).toBe('live_app view');
});

it('get_view_state coerces numeric 0 to false (Max [js] returns numbers, not bools)', async () => {
  lom.lomGet.mockResolvedValueOnce(0).mockResolvedValueOnce('Arranger');
  const text = await callHandlerText(byName('get_view_state').handler);
  expect(JSON.parse(text).browse_mode).toBe(false);
});

it('get_available_views returns the constant list', async () => {
  const text = await callHandlerText(byName('get_available_views').handler);
  const list = JSON.parse(text);
  expect(list).toContain('Browser');
  expect(list).toContain('Detail/Clip');
  expect(list).toContain('Session');
  expect(list).toEqual(family.VIEW_NAMES);
});

it('focus_view delegates to lomCall with view_name', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  await callHandlerText(byName('focus_view').handler, { view_name: 'Browser' });
  expect(lom.lomCall).toHaveBeenCalledWith('live_app view', 'focus_view', 'Browser');
});

it('show_view delegates to lomCall', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  await callHandlerText(byName('show_view').handler, { view_name: 'Detail' });
  expect(lom.lomCall).toHaveBeenCalledWith('live_app view', 'show_view', 'Detail');
});

it('hide_view delegates to lomCall', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  await callHandlerText(byName('hide_view').handler, { view_name: 'Browser' });
  expect(lom.lomCall).toHaveBeenCalledWith('live_app view', 'hide_view', 'Browser');
});

it('is_view_visible coerces numeric truthy to {visible: true}', async () => {
  lom.lomCall.mockResolvedValue(1);
  const text = await callHandlerText(byName('is_view_visible').handler, { view_name: 'Session' });
  expect(JSON.parse(text)).toEqual({ visible: true });
  expect(lom.lomCall).toHaveBeenCalledWith('live_app view', 'is_view_visible', 'Session');
});

it('is_view_visible coerces 0 to {visible: false}', async () => {
  lom.lomCall.mockResolvedValue(0);
  const text = await callHandlerText(byName('is_view_visible').handler, { view_name: 'Browser' });
  expect(JSON.parse(text)).toEqual({ visible: false });
});

it('scroll_view forwards direction + view_name + modifier (boolean → 0/1)', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  await callHandlerText(byName('scroll_view').handler, {
    direction: 2,
    view_name: 'Arranger',
    modifier_pressed: true,
  });
  expect(lom.lomCall).toHaveBeenCalledWith('live_app view', 'scroll_view', 2, 'Arranger', 1);
});

it('scroll_view defaults modifier_pressed=false → 0', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  // Zod default kicks in when caller omits the field.
  await callHandlerText(byName('scroll_view').handler, { direction: 0, view_name: 'Browser' });
  expect(lom.lomCall).toHaveBeenCalledWith('live_app view', 'scroll_view', 0, 'Browser', 0);
});

it('zoom_view forwards direction + view_name + modifier (true → 1)', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  await callHandlerText(byName('zoom_view').handler, {
    direction: 1,
    view_name: 'Arrangement',
    modifier_pressed: true,
  });
  expect(lom.lomCall).toHaveBeenCalledWith('live_app view', 'zoom_view', 1, 'Arrangement', 1);
});

it('zoom_view forwards modifier_pressed=false → 0', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  await callHandlerText(byName('zoom_view').handler, {
    direction: 2,
    view_name: 'Session',
    modifier_pressed: false,
  });
  expect(lom.lomCall).toHaveBeenCalledWith('live_app view', 'zoom_view', 2, 'Session', 0);
});

it('toggle_browse calls toggle_browse on live_app view', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  await callHandlerText(byName('toggle_browse').handler);
  expect(lom.lomCall).toHaveBeenCalledWith('live_app view', 'toggle_browse');
});

// Cover the `view_name || '(main)'` fallback in every view tool's successText
// (empty-string view_name refers to the main Session/Arranger view). The
// fallback is in the wrapper produced by defineTool, so we exercise it by
// invoking the captured handler with view_name=''.
it.each([
  ['focus_view', 'Focused view "(main)"'],
  ['show_view', 'Shown view "(main)"'],
  ['hide_view', 'Hidden view "(main)"'],
])('%s success text falls back to "(main)" for empty view_name', async (name, expected) => {
  lom.lomCall.mockResolvedValue(undefined);
  const text = await callHandlerText(byName(name).handler, { view_name: '' });
  expect(text).toBe(expected);
});

it('scroll_view success text falls back to "(main)" for empty view_name', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  const text = await callHandlerText(byName('scroll_view').handler, {
    direction: 1,
    view_name: '',
    modifier_pressed: false,
  });
  expect(text).toBe('Scrolled "(main)" direction=1');
});

it('zoom_view success text falls back to "(main)" for empty view_name', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  const text = await callHandlerText(byName('zoom_view').handler, {
    direction: 0,
    view_name: '',
    modifier_pressed: false,
  });
  expect(text).toBe('Zoomed "(main)" direction=0');
});

// ── Dialogs ─────────────────────────────────────────────────────────────
it('get_dialog_state aggregates message + button_count + open_count', async () => {
  lom.lomGet
    .mockResolvedValueOnce('Save changes?')
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(1);
  const text = await callHandlerText(byName('get_dialog_state').handler);
  expect(JSON.parse(text)).toEqual({
    message: 'Save changes?',
    button_count: 3,
    open_count: 1,
  });
  for (const c of lom.lomGet.mock.calls) expect(c[0]).toBe('live_app');
});

it('get_dialog_state returns empty string when no dialog is open', async () => {
  // Live returns undefined / null for current_dialog_message when no dialog.
  lom.lomGet.mockResolvedValueOnce(null).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
  const text = await callHandlerText(byName('get_dialog_state').handler);
  expect(JSON.parse(text).message).toBe('');
});

it('press_dialog_button forwards index', async () => {
  lom.lomCall.mockResolvedValue(undefined);
  await callHandlerText(byName('press_dialog_button').handler, { index: 1 });
  expect(lom.lomCall).toHaveBeenCalledWith('live_app', 'press_current_dialog_button', 1);
});
