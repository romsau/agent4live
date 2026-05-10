'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const { lomGet, lomCall, lomGetControlSurfaces, lomGetControlSurfaceControls } = require('../lom');

// Live's main views, used as enum values for focus/show/hide/is_view_visible.
// Source: `Application.View.available_main_views()` returns this exact set.
const VIEW_NAMES = [
  'Browser',
  'Arranger',
  'Session',
  'Detail',
  'Detail/Clip',
  'Detail/DeviceChain',
];

/**
 * Register the Application-level tools on the MCP server : control-surface
 * discovery, view navigation (Application.View), and dialog automation
 * (current_dialog_*). All operate on the LOM `live_app` root.
 *
 * @param {object} server
 */
function register(server) {
  // ── Control surfaces ──────────────────────────────────────────────────
  defineTool(server, {
    name: 'get_control_surfaces',
    description:
      'List the control-surface slots from Live\'s Tempo & MIDI Preferences. Returns JSON: [{index, type_name, is_connected}, ...]. There are typically 6-7 slots; empty slots have type_name="None" and is_connected=false. Connected slots show the script class name (e.g. "Push2", "Komplete_Kontrol_A", "Launchpad", "MaxForLive"). Use this to discover what hardware the user has set up before adapting suggestions or inspecting controls via get_control_surface_controls.',
    handler: () => lomGetControlSurfaces(),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_control_surface_controls',
    description:
      'List the named controls (buttons, knobs, pads) exposed by a given control surface. Returns JSON array of control name strings. The set varies per controller type — e.g. Push exposes "Play_Button", "Tap_Tempo_Button", encoders, pads. These names are what grab_control / send_midi would target (those primitives are not yet exposed via MCP — read-only inspection only for now).',
    schema: {
      surface_index: z
        .number()
        .int()
        .min(0)
        .describe('Control surface index (from get_control_surfaces)'),
    },
    handler: ({ surface_index }) => lomGetControlSurfaceControls(surface_index),
    successText: (_args, json) => String(json),
  });

  // ── View navigation (Application.View) ────────────────────────────────
  defineTool(server, {
    name: 'get_view_state',
    description:
      "Return Live's current view focus and Hot-Swap Mode state. Returns JSON: {browse_mode, focused_document_view}. `browse_mode` is true when Live's Browser is in Hot-Swap Mode for some device (toggled via toggle_browse). `focused_document_view` is 'Session' or 'Arranger' depending on which is visible in the main window.",
    handler: async () => {
      const [browseMode, focused] = await Promise.all([
        lomGet('live_app view', 'browse_mode'),
        lomGet('live_app view', 'focused_document_view'),
      ]);
      return JSON.stringify({
        browse_mode: !!Number(browseMode),
        focused_document_view: focused,
      });
    },
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'get_available_views',
    description: `List the view names accepted by focus_view / show_view / hide_view / is_view_visible / scroll_view / zoom_view. Returns the constant set: ${VIEW_NAMES.map((v) => `"${v}"`).join(', ')}. Provided so the agent doesn't have to guess names.`,
    handler: () => Promise.resolve(JSON.stringify(VIEW_NAMES)),
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'focus_view',
    description:
      'Show the named Live view and focus on it. Pass an empty string ("") to focus the main document view (Session or Arranger, whichever is currently visible). Use get_available_views to see valid names.',
    schema: {
      view_name: z
        .string()
        .describe(
          'View to focus (e.g. "Browser", "Detail/Clip"). Empty string = main document view.',
        ),
    },
    handler: ({ view_name }) => lomCall('live_app view', 'focus_view', view_name),
    successText: ({ view_name }) => `Focused view "${view_name || '(main)'}"`,
  });

  defineTool(server, {
    name: 'show_view',
    description:
      'Show the named Live view (without changing focus). Pass an empty string ("") for the main document view.',
    schema: { view_name: z.string().describe('View to show. Empty string = main document view.') },
    handler: ({ view_name }) => lomCall('live_app view', 'show_view', view_name),
    successText: ({ view_name }) => `Shown view "${view_name || '(main)'}"`,
  });

  defineTool(server, {
    name: 'hide_view',
    description: 'Hide the named Live view. Pass an empty string ("") for the main document view.',
    schema: { view_name: z.string().describe('View to hide. Empty string = main document view.') },
    handler: ({ view_name }) => lomCall('live_app view', 'hide_view', view_name),
    successText: ({ view_name }) => `Hidden view "${view_name || '(main)'}"`,
  });

  defineTool(server, {
    name: 'is_view_visible',
    description:
      'Return whether a Live view is currently visible. Returns JSON: {visible}. Pass an empty string ("") for the main document view.',
    schema: { view_name: z.string().describe('View name. Empty string = main document view.') },
    handler: async ({ view_name }) => {
      const visible = await lomCall('live_app view', 'is_view_visible', view_name);
      return JSON.stringify({ visible: !!Number(visible) });
    },
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'scroll_view',
    description:
      'Scroll a scrollable view (Arranger / Browser / Session / Detail/DeviceChain). direction: 0=up, 1=down, 2=left, 3=right. modifier_pressed: when view_name="Arranger" + direction in {left,right} + modifier=true, modifies the selected time region size instead of moving the playback cursor.',
    schema: {
      direction: z.number().int().min(0).max(3).describe('0=up, 1=down, 2=left, 3=right'),
      view_name: z.string().describe('View to scroll. Empty string = main document view.'),
      modifier_pressed: z.boolean().default(false).describe('Modifier key (Shift) state'),
    },
    handler: ({ direction, view_name, modifier_pressed }) =>
      lomCall('live_app view', 'scroll_view', direction, view_name, modifier_pressed ? 1 : 0),
    successText: ({ direction, view_name }) =>
      `Scrolled "${view_name || '(main)'}" direction=${direction}`,
  });

  defineTool(server, {
    name: 'zoom_view',
    description:
      'Zoom a zoomable view (Arrangement / Session). direction: 0=up, 1=down, 2=left, 3=right. modifier_pressed: when view_name="Arrangement" + modifier=true, restricts vertical zoom to the highlighted track. For Session view, behaves identically to scroll_view.',
    schema: {
      direction: z.number().int().min(0).max(3).describe('0=up, 1=down, 2=left, 3=right'),
      view_name: z.string().describe('View to zoom. Empty string = main document view.'),
      modifier_pressed: z.boolean().default(false).describe('Modifier key (Shift) state'),
    },
    handler: ({ direction, view_name, modifier_pressed }) =>
      lomCall('live_app view', 'zoom_view', direction, view_name, modifier_pressed ? 1 : 0),
    successText: ({ direction, view_name }) =>
      `Zoomed "${view_name || '(main)'}" direction=${direction}`,
  });

  defineTool(server, {
    name: 'toggle_browse',
    description:
      "Toggle Live's Hot-Swap Mode for the currently selected device. While active, the Browser is shown and Browser.load_item / browser_load_item replaces the device's content instead of inserting a new one. Call again to deactivate. Read browse_mode via get_view_state to check current state. Programmatic hot-swap sequence: select_device(track, device) → toggle_browse() → browser_load_item(path) → toggle_browse() to swap a preset without manual UI focus.",
    handler: () => lomCall('live_app view', 'toggle_browse'),
    successText: 'Hot-Swap Mode toggled',
  });

  // ── Dialog automation ─────────────────────────────────────────────────
  defineTool(server, {
    name: 'get_dialog_state',
    description:
      "Return the state of Live's modal dialogs. Returns JSON: {message, button_count, open_count}. `message` is the dialog text (empty string if no dialog is open). `button_count` is the number of buttons in the current dialog (use with press_dialog_button). `open_count` is the total number of stacked dialogs.",
    handler: async () => {
      const [message, buttonCount, openCount] = await Promise.all([
        lomGet('live_app', 'current_dialog_message'),
        lomGet('live_app', 'current_dialog_button_count'),
        lomGet('live_app', 'open_dialog_count'),
      ]);
      return JSON.stringify({
        message: String(message || ''),
        button_count: Number(buttonCount),
        open_count: Number(openCount),
      });
    },
    successText: (_args, json) => String(json),
  });

  defineTool(server, {
    name: 'press_dialog_button',
    description:
      'Press a button in Live\'s currently-open modal dialog by index. Use get_dialog_state first to read the message + button_count. Indices are 0-based ; pressing closes the dialog and applies the corresponding action (e.g. "Save" / "Don\'t Save" / "Cancel").',
    schema: {
      index: z.number().int().min(0).describe('Button index (0-based, < button_count)'),
    },
    handler: ({ index }) => lomCall('live_app', 'press_current_dialog_button', index),
    successText: ({ index }) => `Pressed dialog button ${index}`,
  });
}

module.exports = { register, VIEW_NAMES };
