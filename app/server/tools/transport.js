'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const { lomSet, lomCall } = require('../lom');

/**
 * Register the transport tools (play / stop / continue, record-mode,
 * metronome, tap tempo, scrub) on the MCP server.
 *
 * @param {object} server
 */
function register(server) {
  defineTool(server, {
    name: 'start_playing',
    description:
      'Start the master transport from the current song position. Equivalent to pressing the play button. Use continue_playing to resume from a stopped position, stop_playing to halt.',
    handler: () => lomCall('live_set', 'start_playing'),
    successText: 'Transport started',
  });

  defineTool(server, {
    name: 'stop_playing',
    description:
      'Stop the master transport. Position resets to where it was when play was first pressed (use continue_playing to resume from current position; this tool resets it).',
    handler: () => lomCall('live_set', 'stop_playing'),
    successText: 'Transport stopped',
  });

  defineTool(server, {
    name: 'continue_playing',
    description:
      'Resume playing from the current playback position (does not jump back). Useful after stop_playing if you want to pick up where you left off.',
    handler: () => lomCall('live_set', 'continue_playing'),
    successText: 'Transport continued',
  });

  defineTool(server, {
    name: 'set_metronome',
    description:
      'Toggle the metronome on or off. The metronome ticks on every beat at the current tempo and time signature.',
    schema: { on: z.boolean().describe('true = enable metronome, false = disable') },
    handler: ({ on }) => lomSet('live_set', 'metronome', on ? 1 : 0),
    successText: ({ on }) => `Metronome ${on ? 'enabled' : 'disabled'}`,
  });

  defineTool(server, {
    name: 'set_record_mode',
    description:
      'Toggle session/arrangement record mode. When on, armed tracks record incoming MIDI/audio when transport plays. Combine with arm_track and start_playing for live recording.',
    schema: { on: z.boolean().describe('true = arm record button, false = disarm') },
    handler: ({ on }) => lomSet('live_set', 'record_mode', on ? 1 : 0),
    successText: ({ on }) => `Record mode ${on ? 'enabled' : 'disabled'}`,
  });

  defineTool(server, {
    name: 'tap_tempo',
    description:
      'Tap the tempo. Each call counts as one tap. Live needs at least 2 taps to detect a tempo, more for accuracy. Mostly useful for matching to an external source the agent has been told the BPM of — usually you want set_tempo instead.',
    handler: () => lomCall('live_set', 'tap_tempo'),
    successText: 'Tap registered',
  });

  defineTool(server, {
    name: 'capture_midi',
    description:
      'Capture recently played MIDI material from audible tracks into a Live Clip. Same as the "Capture" button in Live\'s transport bar. destination 0=auto (Live picks based on view), 1=session, 2=arrangement.',
    schema: {
      destination: z
        .number()
        .int()
        .min(0)
        .max(2)
        .default(0)
        .describe('0=auto, 1=session, 2=arrangement'),
    },
    handler: ({ destination }) => lomCall('live_set', 'capture_midi', destination),
    successText: ({ destination }) => `MIDI captured (destination=${destination})`,
  });

  defineTool(server, {
    name: 'trigger_session_record',
    description:
      'Toggle the Session Record button. Starts recording in the selected slot or the next empty slot if the track is armed. If record_length is provided, the slot will record for that many beats then stop. Calling again while recording stops the recording and starts clip playback.',
    schema: {
      record_length: z
        .number()
        .positive()
        .optional()
        .describe('Optional: length in beats. Omit to record until manually stopped.'),
    },
    handler: ({ record_length }) =>
      record_length === undefined
        ? lomCall('live_set', 'trigger_session_record')
        : lomCall('live_set', 'trigger_session_record', record_length),
    successText: ({ record_length }) =>
      `Session record triggered${record_length !== undefined ? ` (length ${record_length} beats)` : ''}`,
  });

  defineTool(server, {
    name: 'jump_by',
    description:
      'Jump the Arrangement playback position by a relative number of beats. Negative beats jump backwards. Unquantized — happens immediately. Use set_song_time for absolute positioning.',
    schema: {
      beats: z
        .number()
        .describe('Relative jump in beats (positive = forward, negative = backward)'),
    },
    handler: ({ beats }) => lomCall('live_set', 'jump_by', beats),
    successText: ({ beats }) => `Jumped by ${beats} beats`,
  });

  defineTool(server, {
    name: 'scrub_by',
    description:
      'Scrub the Arrangement playback position by a relative number of beats. Per Live 12 doc, currently identical to jump_by. Provided for forward-compat with potential future quantize-aware behavior.',
    schema: { beats: z.number().describe('Relative scrub in beats') },
    handler: ({ beats }) => lomCall('live_set', 'scrub_by', beats),
    successText: ({ beats }) => `Scrubbed by ${beats} beats`,
  });

  defineTool(server, {
    name: 'undo',
    description:
      'Undo the last STRUCTURAL action in Live (track/scene/clip creation, device add, parameter automation). Mirrors Cmd-Z. Can be called multiple times to undo a sequence. \n\nDANGER: prop toggles (metronome, record_mode, transport state, mute/solo/arm) are NOT in the undo stack — calling undo after only those will skip them and unroll an earlier action, which can include the agent4live device drop itself, killing this MCP server. Avoid undo unless you know the most recent action was structural.',
    handler: () => lomCall('live_set', 'undo'),
    successText: 'Undone (warning: see tool description for caveats)',
  });

  defineTool(server, {
    name: 'redo',
    description:
      "Redo the last undone action. Mirrors Cmd-Shift-Z. Only valid if undo was the most recent operation — any new structural edit clears the redo stack. Same caveat as undo: redo applies to Live's structural undo stack, not toggle props.",
    handler: () => lomCall('live_set', 'redo'),
    successText: 'Redone',
  });
}

module.exports = { register };
