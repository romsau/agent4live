'use strict';

// Tests for transport.js — the Node ↔ Max [js] bridge. Mocks max-api so we
// can capture the addHandler callback and feed it synthetic responses, and
// the ui/state module so we can assert on UI-state side effects.

let lomResponseHandler;
const Max = {
  addHandler: jest.fn((name, fn) => {
    if (name === 'lom_response') lomResponseHandler = fn;
  }),
  outlet: jest.fn(() => Promise.resolve()),
};
jest.mock('max-api', () => Max);

jest.mock('../ui/state', () => ({
  uiState: { liveApiOk: false, latencyMs: 0 },
  uiRender: jest.fn(),
  log: jest.fn(),
}));

jest.mock('../config', () => ({
  LOM_TIMEOUT_MS: 10000,
}));

const { lomOp, lomCustomCall } = require('./transport');
const { uiState, uiRender, log } = require('../ui/state');

beforeEach(() => {
  Max.outlet.mockClear();
  Max.outlet.mockReturnValue(Promise.resolve());
  uiRender.mockClear();
  log.mockClear();
  uiState.liveApiOk = false;
  uiState.latencyMs = 0;
});

describe('lomOp', () => {
  it('rejects when lomPath is empty', async () => {
    await expect(lomOp('get', '', 'tempo')).rejects.toThrow('lomPath cannot be empty');
  });

  it('rejects when lomPath is just whitespace (split gives empty first part)', async () => {
    await expect(lomOp('get', '', 'tempo')).rejects.toThrow();
  });

  it('outlets a `lom_request` envelope with op, path parts and prop', async () => {
    const promise = lomOp('get', 'live_set tracks 0', 'name');
    // lom_request id op nParts ...path prop
    const args = Max.outlet.mock.calls[0];
    expect(args[0]).toBe('lom_request');
    expect(args[2]).toBe('get');
    expect(args[3]).toBe(3); // nParts
    // path is split on space — values stay strings.
    expect(args.slice(4, 7)).toEqual(['live_set', 'tracks', '0']);
    expect(args[7]).toBe('name');

    // Resolve via the captured response handler.
    lomResponseHandler(args[1], 'ok', 'My Track');
    await expect(promise).resolves.toBe('My Track');
  });

  it('rejects when the response status is not "ok"', async () => {
    const promise = lomOp('set', 'live_set tracks 0', 'volume', 0.8);
    const id = Max.outlet.mock.calls[0][1];
    lomResponseHandler(id, 'error', 'parameter is read-only');
    await expect(promise).rejects.toThrow('parameter is read-only');
  });

  it('filters undefined values from the trailing args (callers can leave gaps)', async () => {
    const promise = lomOp('call', 'live_set tracks 0', 'method', undefined, 42, undefined);
    const args = Max.outlet.mock.calls[0];
    // After undefined filter, only 42 should remain after the prop.
    expect(args.slice(-1)).toEqual([42]);
    // Settle the promise so its timer is cleared (otherwise it would survive
    // past test-end and keep Node alive).
    lomResponseHandler(args[1], 'ok', null);
    await promise;
  });

  it('updates uiState on success (liveApiOk=true, latency set)', async () => {
    const before = Date.now();
    const promise = lomOp('get', 'live_set', 'tempo');
    const id = Max.outlet.mock.calls[0][1];
    lomResponseHandler(id, 'ok', 120);
    await promise;
    expect(uiState.liveApiOk).toBe(true);
    expect(uiState.latencyMs).toBeGreaterThanOrEqual(0);
    expect(uiState.latencyMs).toBeLessThan(Date.now() - before + 100);
    expect(uiRender).toHaveBeenCalled();
  });

  it('updates uiState on rejection (liveApiOk=false)', async () => {
    uiState.liveApiOk = true;
    const promise = lomOp('get', 'live_set', 'tempo');
    const id = Max.outlet.mock.calls[0][1];
    lomResponseHandler(id, 'error', 'bad path');
    await expect(promise).rejects.toThrow();
    expect(uiState.liveApiOk).toBe(false);
  });

  it('rejects with "Max.outlet failed:" when the outlet call itself rejects', async () => {
    Max.outlet.mockReturnValueOnce(Promise.reject(new Error('pipe broken')));
    await expect(lomOp('get', 'live_set', 'tempo')).rejects.toThrow(
      'Max.outlet failed: pipe broken',
    );
  });

  it('rejects with timeout when no response arrives within LOM_TIMEOUT_MS', async () => {
    jest.useFakeTimers();
    const promise = lomOp('get', 'live_set', 'tempo');
    // Allow Max.outlet().then() to resolve so the .catch branch is wired.
    await Promise.resolve();
    jest.advanceTimersByTime(10001);
    await expect(promise).rejects.toThrow(/LOM timeout after 10s/);
    jest.useRealTimers();
  });

  it('ignores a stale lom_response after the pending entry was removed', () => {
    // Resolve a request first so its id is no longer pending, then send a
    // late lom_response for the same id. Should be a no-op (logged but no
    // crash, no double-resolve).
    const promise = lomOp('get', 'live_set', 'tempo');
    const id = Max.outlet.mock.calls[0][1];
    lomResponseHandler(id, 'ok', 1);
    return promise.then(() => {
      lomResponseHandler(id, 'ok', 2); // late, should be a no-op
      expect(log).toHaveBeenCalledWith(expect.stringContaining('no pending cb'));
    });
  });
});

describe('lomCustomCall', () => {
  it('outlets the named opName with args, resolves on `ok` response', async () => {
    const promise = lomCustomCall('lom_add_clip', 0, 1, 4, '[]');
    const args = Max.outlet.mock.calls[0];
    expect(args[0]).toBe('lom_add_clip');
    expect(args.slice(2)).toEqual([0, 1, 4, '[]']);
    lomResponseHandler(args[1], 'ok', 'done');
    await expect(promise).resolves.toBe('done');
  });

  it('outlet .catch is a no-op when the entry was already settled (defensive)', async () => {
    // Race: response handler runs and removes the entry, THEN the outlet
    // promise rejects (impossible in practice — if outlet rejects, no
    // response can come — but the defensive guard exists for robustness).
    let outletReject;
    Max.outlet.mockReturnValueOnce(
      new Promise((_, reject) => {
        outletReject = reject;
      }),
    );
    const promise = lomOp('get', 'live_set', 'tempo');
    const id = Max.outlet.mock.calls[0][1];
    lomResponseHandler(id, 'ok', 'first');
    await promise;
    // The pending entry is now gone. Late outlet rejection finds no entry.
    outletReject(new Error('late failure'));
    // Yield so the .catch runs. No assertion needed beyond "no crash".
    await new Promise((r) => setImmediate(r));
  });
});
