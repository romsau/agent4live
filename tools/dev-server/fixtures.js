'use strict';

// Named state snapshots that match the shape of `uiState` in server/ui/state.js.
// Use these to preview the device UI under conditions that are tedious to reproduce
// in Live (no agents installed, restart pending, log saturated, big latency, etc.).

const allRedAgents = {
  claudeCode: { detected: false, registered: false },
  opencode: { detected: false, registered: false },
  gemini: { detected: false, registered: false },
};

const allGreenAgents = {
  claudeCode: { detected: true, registered: true },
  opencode: { detected: true, registered: true },
  gemini: { detected: true, registered: true },
};

// Single agent consented (Claude Code) + others detected but not consented.
// Mirrors the mutex single-agent rule and gives the AGENT card a green status
// for the post-onboarding "device idle" preview.
const claudeConsented = {
  claudeCode: { detected: true, registered: true, consented: true },
  opencode: { detected: true, registered: false, consented: false },
  gemini: { detected: true, registered: false, consented: false },
};

// Used to preview the consent modal (3 detected agents, none consented yet).
const allDetectedNotConsented = {
  claudeCode: { detected: true, registered: false, consented: false },
  opencode: { detected: true, registered: false, consented: false },
  gemini: { detected: true, registered: false, consented: false },
};

// Extension lifecycle snapshots. The cascade renders modal A (install) when
// scriptInstalled=false, modal B (configure Preferences) when script is in
// place but pingOk=false, and falls through to consent / normal view when both
// are true.
const extensionReady = { scriptInstalled: true, pingOk: true };
const extensionAbsent = { scriptInstalled: false, pingOk: false };
const extensionScriptOnly = { scriptInstalled: true, pingOk: false };

const sampleLogs = [
  { ts: '14:23:01', tool: 'set_tempo(120)', result: 'ok', isError: false },
  { ts: '14:23:05', tool: 'create_midi_track(Pad)', result: 'ok', isError: false },
  { ts: '14:23:07', tool: 'add_clip(0,0)', result: 'ok', isError: false },
  { ts: '14:23:12', tool: 'fire_clip(0,0)', result: 'ok', isError: false },
  { ts: '14:23:18', tool: 'get_session_state', result: 'ok', isError: false },
];

/**
 * Two-digit zero-pad for clock display (`9` → `09`).
 *
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Build a 50-entry mock log feed (mix of ok / error rows) for the
 * `log-saturated` fixture used to preview UI behavior under load.
 *
 * @returns {Array<{ts: string, tool: string, result: string, isError: boolean}>}
 */
function genSaturatedLogs() {
  const tools = [
    'set_tempo(140)',
    'add_clip(0,0)',
    'create_midi_track',
    'fire_clip(2,1)',
    'lom_get(live_set,tempo)',
    'stop_all_clips',
    'get_session_state',
  ];
  const out = [];
  for (let i = 0; i < 50; i++) {
    const m = pad2(20 + Math.floor(i / 12));
    const s = pad2(i % 60);
    const isErr = i % 11 === 0;
    out.push({
      ts: `14:${m}:${s}`,
      tool: tools[i % tools.length],
      result: isErr ? 'invalid track index' : 'ok',
      isError: isErr,
    });
  }
  return out;
}

module.exports = {
  default: {
    mode: 'active',
    activePeer: null,
    connected: true,
    port: 19845,
    liveApiOk: true,
    latencyMs: 12,
    logs: sampleLogs.slice(0, 3),
    agents: allGreenAgents,
    extensionStatus: extensionReady,
  },

  // Post-onboarding "device idle" preview — Claude Code consented, MCP+LIVEAPI
  // up, but no agent call has happened yet. Empty log → the UI shows the
  // "Waiting for the first agent call..." placeholder ; the 3 header cards
  // (MCP/LIVEAPI/AGENT) all render green.
  'default-idle': {
    mode: 'active',
    activePeer: null,
    connected: true,
    port: 19845,
    liveApiOk: true,
    latencyMs: 12,
    logs: [],
    agents: claudeConsented,
    extensionStatus: extensionReady,
  },

  'log-saturated': {
    connected: true,
    port: 19845,
    liveApiOk: true,
    latencyMs: 18,
    logs: genSaturatedLogs(),
    agents: allGreenAgents,
    extensionStatus: extensionReady,
  },

  'passive-warning': {
    mode: 'passive',
    activePeer: { trackName: '1-MIDI' },
    connected: false,
    port: 19845,
    liveApiOk: false,
    latencyMs: 0,
    logs: [],
    agents: allRedAgents,
    extensionStatus: extensionReady,
  },

  'passive-warning-no-track': {
    mode: 'passive',
    activePeer: null,
    connected: false,
    port: 19845,
    liveApiOk: false,
    latencyMs: 0,
    logs: [],
    agents: allRedAgents,
    extensionStatus: extensionReady,
  },

  // Welcome modal — first boot, no consent yet, two of three agents detected.
  'consent-modal-mixed': {
    mode: 'active',
    activePeer: null,
    connected: true,
    port: 19845,
    liveApiOk: true,
    latencyMs: 12,
    logs: [],
    agents: {
      claudeCode: { detected: true, registered: false, consented: false },
      gemini: { detected: false, registered: false, consented: false },
      opencode: { detected: true, registered: false, consented: false },
    },
    firstBoot: true,
    extensionStatus: extensionReady,
  },

  // All three agents detected → modal lets the user pick any subset.
  'consent-modal-all-detected': {
    mode: 'active',
    activePeer: null,
    connected: true,
    port: 19845,
    liveApiOk: true,
    latencyMs: 12,
    logs: [],
    agents: allDetectedNotConsented,
    firstBoot: true,
    extensionStatus: extensionReady,
  },

  // Modal "Restart Live" — extension vient d'être installé (clic sur INSTALL
  // a réussi), Live n'a pas encore été redémarré donc le ping n'aboutit
  // toujours pas. justInstalled=true verrouille l'UI sur ce modal jusqu'au
  // reload de page (= restart Live qui re-drop le device en pratique).
  'extension-restart-pending': {
    mode: 'active',
    activePeer: null,
    connected: true,
    port: 19845,
    liveApiOk: true,
    latencyMs: 12,
    logs: [],
    agents: allRedAgents,
    firstBoot: true,
    extensionStatus: extensionScriptOnly,
    justInstalled: true,
  },

  // Modal A — extension script not yet installed in User Library.
  'extension-needs-install': {
    mode: 'active',
    activePeer: null,
    connected: true,
    port: 19845,
    liveApiOk: true,
    latencyMs: 12,
    logs: [],
    agents: allRedAgents,
    firstBoot: true,
    extensionStatus: extensionAbsent,
  },

  // Modal B — script installed but ping ko (Preferences not configured yet).
  'extension-needs-config': {
    mode: 'active',
    activePeer: null,
    connected: true,
    port: 19845,
    liveApiOk: true,
    latencyMs: 12,
    logs: [],
    agents: allRedAgents,
    firstBoot: true,
    extensionStatus: extensionScriptOnly,
  },
};
