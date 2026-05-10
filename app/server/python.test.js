'use strict';

// We mock `net` so the tests never open a real socket. Each test stages a
// fake server response (a Node EventEmitter that emits 'data'/'close') and
// asserts what python.js writes back.

jest.mock('net');

const net = require('net');
const { EventEmitter } = require('events');

/**
 * Build a fake `net.Socket` that records writes and lets the test push
 * inbound data + close events.
 */
function makeFakeSocket() {
  const socket = new EventEmitter();
  socket.connect = jest.fn((_port, _host, cb) => {
    if (cb) setImmediate(cb);
  });
  socket.write = jest.fn();
  socket.setEncoding = jest.fn();
  socket.destroy = jest.fn();
  return socket;
}

// Note: no jest.resetModules() — that would re-require `net` and dissociate
// our `net.Socket.mockImplementation()` from the instance python.js sees.
beforeEach(() => {
  jest.clearAllMocks();
});

describe('pythonCall', () => {
  it('writes a JSON line + newline and resolves with the parsed response', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { pythonCall } = require('./python');
    const promise = pythonCall({ method: 'ping' });
    // Wait for connect() callback so write is queued.
    await new Promise((r) => setImmediate(r));
    expect(socket.write).toHaveBeenCalledWith('{"method":"ping"}\n');
    socket.emit('data', '{"ok":true,"pong":true}\n');
    expect(await promise).toEqual({ ok: true, pong: true });
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('handles responses chunked over multiple data events', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { pythonCall } = require('./python');
    const promise = pythonCall({ method: 'x' });
    await new Promise((r) => setImmediate(r));
    socket.emit('data', '{"ok":');
    socket.emit('data', 'true,"v":1}');
    socket.emit('data', '\n');
    expect(await promise).toEqual({ ok: true, v: 1 });
  });

  it('rejects on bad JSON', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { pythonCall } = require('./python');
    const promise = pythonCall({});
    await new Promise((r) => setImmediate(r));
    socket.emit('data', '{not-json\n');
    await expect(promise).rejects.toThrow(/bad JSON/);
  });

  it('rejects when the socket emits an error', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { pythonCall } = require('./python');
    const promise = pythonCall({});
    await new Promise((r) => setImmediate(r));
    socket.emit('error', new Error('ECONNREFUSED'));
    await expect(promise).rejects.toThrow(/ECONNREFUSED/);
  });

  it('ignores a late close event after a successful data settle (idempotent settle)', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { pythonCall } = require('./python');
    const promise = pythonCall({});
    await new Promise((r) => setImmediate(r));
    socket.emit('data', '{"ok":true}\n');
    expect(await promise).toEqual({ ok: true });
    // A spurious 'close' arrives after settle — must be a no-op (no
    // unhandled rejection, no double-settle).
    expect(() => socket.emit('close')).not.toThrow();
  });

  it('rejects when the socket closes before a full line is received', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { pythonCall } = require('./python');
    const promise = pythonCall({});
    await new Promise((r) => setImmediate(r));
    socket.emit('close');
    await expect(promise).rejects.toThrow(/closed connection/);
  });

  it('rejects with a timeout when no data arrives', async () => {
    jest.useFakeTimers();
    try {
      const socket = makeFakeSocket();
      net.Socket.mockImplementation(() => socket);
      const { pythonCall } = require('./python');
      const promise = pythonCall({}, 100);
      await Promise.resolve();
      jest.advanceTimersByTime(150);
      await expect(promise).rejects.toThrow(/timeout/);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('uses the default timeout when none provided', async () => {
    jest.useFakeTimers();
    try {
      const socket = makeFakeSocket();
      net.Socket.mockImplementation(() => socket);
      const { pythonCall } = require('./python');
      const promise = pythonCall({});
      jest.advanceTimersByTime(5100);
      await expect(promise).rejects.toThrow(/timeout/);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('ping / isAlive', () => {
  it('ping resolves to the dispatcher response', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { ping } = require('./python');
    const promise = ping();
    await new Promise((r) => setImmediate(r));
    socket.emit('data', '{"ok":true,"version":1}\n');
    expect(await promise).toEqual({ ok: true, version: 1 });
  });

  it('isAlive returns true on a successful ping', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { isAlive } = require('./python');
    const promise = isAlive();
    await new Promise((r) => setImmediate(r));
    socket.emit('data', '{"ok":true}\n');
    expect(await promise).toBe(true);
  });

  it('isAlive returns false when ping fails', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { isAlive } = require('./python');
    const promise = isAlive();
    await new Promise((r) => setImmediate(r));
    socket.emit('error', new Error('refused'));
    expect(await promise).toBe(false);
  });

  it('isAlive returns false when ping returns ok:false', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { isAlive } = require('./python');
    const promise = isAlive();
    await new Promise((r) => setImmediate(r));
    socket.emit('data', '{"ok":false}\n');
    expect(await promise).toBe(false);
  });
});

describe('browser helpers', () => {
  it('browserList sends method browser_list with path', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { browserList } = require('./python');
    const promise = browserList('instruments');
    await new Promise((r) => setImmediate(r));
    expect(socket.write.mock.calls[0][0]).toContain('"method":"browser_list"');
    expect(socket.write.mock.calls[0][0]).toContain('"path":"instruments"');
    socket.emit('data', '{"ok":true,"items":[]}\n');
    expect(await promise).toEqual({ ok: true, items: [] });
  });

  it('browserList defaults missing path to empty string', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { browserList } = require('./python');
    const promise = browserList();
    await new Promise((r) => setImmediate(r));
    expect(socket.write.mock.calls[0][0]).toContain('"path":""');
    socket.emit('data', '{"ok":true,"items":[]}\n');
    await promise;
  });

  it('browserLoadItem sends method browser_load with path', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { browserLoadItem } = require('./python');
    const promise = browserLoadItem('/drums/Foo.adg');
    await new Promise((r) => setImmediate(r));
    expect(socket.write.mock.calls[0][0]).toContain('"method":"browser_load"');
    expect(socket.write.mock.calls[0][0]).toContain('"path":"/drums/Foo.adg"');
    socket.emit('data', '{"ok":true,"loaded":"Foo"}\n');
    expect(await promise).toEqual({ ok: true, loaded: 'Foo' });
  });

  it('browserSearch sends method browser_search with query/root/limit', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { browserSearch } = require('./python');
    const promise = browserSearch('kick', 'drums', 10);
    await new Promise((r) => setImmediate(r));
    const sent = socket.write.mock.calls[0][0];
    expect(sent).toContain('"query":"kick"');
    expect(sent).toContain('"root":"drums"');
    expect(sent).toContain('"limit":10');
    socket.emit('data', '{"ok":true,"results":[]}\n');
    expect(await promise).toEqual({ ok: true, results: [] });
  });

  it('browserSearch defaults missing root + limit', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { browserSearch } = require('./python');
    const promise = browserSearch('foo');
    await new Promise((r) => setImmediate(r));
    const sent = socket.write.mock.calls[0][0];
    expect(sent).toContain('"root":""');
    expect(sent).toContain('"limit":50');
    socket.emit('data', '{"ok":true,"results":[]}\n');
    await promise;
  });
});

describe('midi helpers', () => {
  it('sendMidi sends method send_midi with status/data1/data2', async () => {
    const socket = makeFakeSocket();
    net.Socket.mockImplementation(() => socket);
    const { sendMidi } = require('./python');
    const promise = sendMidi(0x90, 60, 100);
    await new Promise((r) => setImmediate(r));
    const sent = socket.write.mock.calls[0][0];
    expect(sent).toContain('"method":"send_midi"');
    expect(sent).toContain('"status":144'); // 0x90
    expect(sent).toContain('"data1":60');
    expect(sent).toContain('"data2":100');
    socket.emit('data', '{"ok":true}\n');
    expect(await promise).toEqual({ ok: true });
  });
});
