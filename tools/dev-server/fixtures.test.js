'use strict';

const fixtures = require('./fixtures');

describe('fixtures', () => {
  it('exposes the named UI snapshots used by the dev-server', () => {
    const expected = [
      'default',
      'default-idle',
      'log-saturated',
      'passive-warning',
      'passive-warning-no-track',
      'consent-modal-mixed',
      'consent-modal-all-detected',
      'companion-restart-pending',
    ];
    for (const k of expected) {
      expect(fixtures[k]).toBeDefined();
      expect(fixtures[k].agents).toBeDefined();
    }
  });

  it('log-saturated fixture has 50 generated entries with mixed errors', () => {
    const sat = fixtures['log-saturated'].logs;
    expect(sat).toHaveLength(50);
    expect(sat.some((e) => e.isError === true)).toBe(true);
    expect(sat.some((e) => e.isError === false)).toBe(true);
    // Two-digit zero-padding format `14:MM:SS`.
    expect(sat[0].ts).toMatch(/^14:\d{2}:\d{2}$/);
    // Verify pad2 is reached for both single- and two-digit values.
    expect(sat[9].ts).toMatch(/^14:\d{2}:09$/);
    expect(sat[15].ts).toMatch(/^14:\d{2}:15$/);
  });

  it('passive-warning has activePeer.trackName, passive-warning-no-track does not', () => {
    expect(fixtures['passive-warning'].activePeer).toEqual({ trackName: '1-MIDI' });
    expect(fixtures['passive-warning-no-track'].activePeer).toBeNull();
  });

  it('consent fixtures expose firstBoot + per-agent consented flags', () => {
    expect(fixtures['consent-modal-mixed'].firstBoot).toBe(true);
    expect(fixtures['consent-modal-mixed'].agents.gemini.detected).toBe(false);
    expect(fixtures['consent-modal-all-detected'].firstBoot).toBe(true);
    for (const k of ['claudeCode', 'codex', 'gemini', 'opencode']) {
      expect(fixtures['consent-modal-all-detected'].agents[k].consented).toBe(false);
      expect(fixtures['consent-modal-all-detected'].agents[k].detected).toBe(true);
    }
  });
});
