'use strict';

jest.mock('../../lom', () => ({
  lomSet: jest.fn(() => Promise.resolve()),
  lomCall: jest.fn(() => Promise.resolve()),
  lomSessionState: jest.fn(() => Promise.resolve(JSON.stringify({ track_count: 3 }))),
}));
jest.mock('../../ui/state', () => ({ uiLog: jest.fn() }));

const { collectTools, callHandlerText } = require('../../../../tools/test/tool-test-utils');
const lom = require('../../lom');
const family = require('./mixer_lifecycle');

const tools = collectTools(family.register);
const byName = (name) => tools.find((t) => t.name === name);
const trackPath = (t) => `live_set tracks ${t}`;
const mixerPath = (t) => `${trackPath(t)} mixer_device`;

beforeEach(() => {
  for (const fn of Object.values(lom)) fn.mockClear();
});

it('every description is non-empty', () => {
  for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
});

describe('mixer setters', () => {
  it('set_track_volume writes mixer volume value', async () => {
    expect(
      await callHandlerText(byName('set_track_volume').handler, { track: 0, value: 0.85 }),
    ).toBe('Volume of track 0 set to 0.85');
    expect(lom.lomSet).toHaveBeenCalledWith(`${mixerPath(0)} volume`, 'value', 0.85);
  });

  it('set_track_panning writes mixer panning value', async () => {
    await callHandlerText(byName('set_track_panning').handler, { track: 0, value: -0.5 });
    expect(lom.lomSet).toHaveBeenCalledWith(`${mixerPath(0)} panning`, 'value', -0.5);
  });

  it('set_track_send writes the indexed send value', async () => {
    await callHandlerText(byName('set_track_send').handler, {
      track: 0,
      send_index: 1,
      value: 0.5,
    });
    expect(lom.lomSet).toHaveBeenCalledWith(`${mixerPath(0)} sends 1`, 'value', 0.5);
  });
});

describe('create_*_track', () => {
  it('create_midi_track without name: only the create call', async () => {
    await callHandlerText(byName('create_midi_track').handler, {});
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'create_midi_track', -1);
    expect(lom.lomSet).not.toHaveBeenCalled();
    expect(lom.lomSessionState).not.toHaveBeenCalled();
  });

  it('create_midi_track with name + index=-1 resolves to track_count-1 and sets the name', async () => {
    await callHandlerText(byName('create_midi_track').handler, { name: 'Lead' });
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'create_midi_track', -1);
    expect(lom.lomSessionState).toHaveBeenCalled();
    // track_count=3 → trackIndex=2
    expect(lom.lomSet).toHaveBeenCalledWith(trackPath(2), 'name', 'Lead');
  });

  it('create_audio_track with explicit index sets name on that index', async () => {
    await callHandlerText(byName('create_audio_track').handler, { index: 1, name: 'Vocals' });
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'create_audio_track', 1);
    expect(lom.lomSet).toHaveBeenCalledWith(trackPath(1), 'name', 'Vocals');
  });

  it('create_audio_track without name only creates (covers falsy label/successText branches)', async () => {
    expect(await callHandlerText(byName('create_audio_track').handler, {})).toBe(
      'Audio track created',
    );
    expect(lom.lomSet).not.toHaveBeenCalled();
  });

  it('throws when session_state JSON parsing fails', async () => {
    lom.lomSessionState.mockResolvedValueOnce('not json');
    await expect(byName('create_midi_track').handler({ name: 'X' })).rejects.toThrow(
      /Failed to parse session state/,
    );
  });

  it('throws when track_count is missing or invalid in session state', async () => {
    lom.lomSessionState.mockResolvedValueOnce('{"track_count":"bad"}');
    await expect(byName('create_midi_track').handler({ name: 'X' })).rejects.toThrow(
      /Unexpected track_count/,
    );
  });

  it('create_return_track delegates to live_set create_return_track', async () => {
    await callHandlerText(byName('create_return_track').handler);
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'create_return_track');
  });
});

describe('toggle setters (mute/solo/arm)', () => {
  it.each([
    ['mute_track', 'mute', 'muted', 'unmuted'],
    ['solo_track', 'solo', 'soloed', 'un-soloed'],
    ['arm_track', 'arm', 'armed', 'disarmed'],
  ])('%s encodes boolean → 1/0 and recaps', async (name, prop, onText, offText) => {
    expect(await callHandlerText(byName(name).handler, { track: 0, on: true })).toBe(
      `Track 0 ${onText}`,
    );
    expect(lom.lomSet).toHaveBeenLastCalledWith(trackPath(0), prop, 1);
    expect(await callHandlerText(byName(name).handler, { track: 0, on: false })).toBe(
      `Track 0 ${offText}`,
    );
    expect(lom.lomSet).toHaveBeenLastCalledWith(trackPath(0), prop, 0);
  });
});

describe('rename / color', () => {
  it('set_track_name writes name', async () => {
    await callHandlerText(byName('set_track_name').handler, { track: 0, name: 'Drums' });
    expect(lom.lomSet).toHaveBeenCalledWith(trackPath(0), 'name', 'Drums');
  });

  it('set_track_color writes color and recaps in zero-padded hex', async () => {
    expect(
      await callHandlerText(byName('set_track_color').handler, { track: 0, color: 0xff8800 }),
    ).toBe('Track 0 color set to 0xFF8800');
  });
});

describe('delete / duplicate', () => {
  it('delete_track calls live_set delete_track with index', async () => {
    await callHandlerText(byName('delete_track').handler, { index: 2 });
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'delete_track', 2);
  });

  it('duplicate_track calls live_set duplicate_track with index', async () => {
    await callHandlerText(byName('duplicate_track').handler, { index: 1 });
    expect(lom.lomCall).toHaveBeenCalledWith('live_set', 'duplicate_track', 1);
  });
});
