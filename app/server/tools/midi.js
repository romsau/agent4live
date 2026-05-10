'use strict';

const { z } = require('zod');
const { defineTool } = require('./define');
const { sendMidi, isAlive } = require('../python');

/**
 * Standard error when the Python companion isn't reachable. MIDI tools
 * (like the Browser API tools) require the companion installed AND assigned
 * in Live's Preferences → Tempo & MIDI → Control Surface dropdown.
 *
 * @returns {Error}
 */
function companionUnreachableError() {
  return new Error(
    'MIDI raw tools require the agent4live Python companion. ' +
      'Install via `node tools/companion/install.js`, restart Live, and assign ' +
      '"agent4live" in Preferences → Tempo & MIDI → Control Surface (with Input ' +
      'and/or Output ports as needed).',
  );
}

/**
 * @param {object} response - Whatever the Python companion returned.
 * @returns {object} The response if ok ; throws otherwise.
 */
function unwrap(response) {
  if (response && response.ok) return response;
  throw new Error((response && response.error) || 'companion returned an error');
}

/**
 * Throws a friendly error when the companion can't be reached, otherwise no-op.
 *
 * @returns {Promise<void>}
 */
async function ensureCompanion() {
  const alive = await isAlive();
  if (!alive) throw companionUnreachableError();
}

/**
 * Register the MIDI raw tools (send only — receive is deferred pending
 * Live 12 InputControlElement dependency-injection rework). The send tool
 * routes through the Python companion : it writes to the Output port
 * assigned to the agent4live Control Surface slot in Live → Preferences →
 * Tempo & MIDI. If the slot's Output is "None", the message is silently
 * dropped by Live — no error returned.
 *
 * @param {object} server
 */
function register(server) {
  defineTool(server, {
    name: 'send_midi',
    description:
      "Send a 3-byte MIDI message on the Output port assigned to agent4live's " +
      'Control Surface slot in Live → Preferences → Tempo & MIDI. Bytes follow ' +
      'standard MIDI: status byte (0x80–0xEF) encodes message type + channel, ' +
      'then two data bytes (0–127 each). Examples: status=0x90 + note + ' +
      'velocity = note-on channel 1 (status=0x9F = note-on channel 16) ; ' +
      'status=0xB0 + cc + value = control-change channel 1 ; status=0x80 + ' +
      'note + 0 = explicit note-off (or status=0x90 + note + 0 = running-' +
      'status note-off). If the slot has Output = "None", the message is ' +
      'silently dropped by Live (no error returned). Requires the agent4live ' +
      'Python companion.',
    schema: {
      status: z
        .number()
        .int()
        .min(0)
        .max(255)
        .describe('Status byte (0x80–0xEF, encodes message type + MIDI channel 1–16)'),
      data1: z.number().int().min(0).max(127).describe('First data byte (note no. or CC no.)'),
      data2: z.number().int().min(0).max(127).describe('Second data byte (velocity or CC value)'),
    },
    handler: async ({ status, data1, data2 }) => {
      await ensureCompanion();
      unwrap(await sendMidi(status, data1, data2));
      return `MIDI sent: status=0x${status.toString(16).padStart(2, '0')} data1=${data1} data2=${data2}`;
    },
    successText: (_args, text) => String(text),
  });
}

module.exports = { register };
