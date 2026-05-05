'use strict';

// Tests for queue.js — the FIFO serializer that ensures only one LOM op is
// in flight at a time. Pure logic, no external deps.

const { enqueue } = require('./queue');

const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('enqueue', () => {
  it('resolves with the task result', async () => {
    const result = await enqueue(() => Promise.resolve('hello'));
    expect(result).toBe('hello');
  });

  it('propagates task rejection', async () => {
    await expect(enqueue(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('runs tasks sequentially (one in flight at a time)', async () => {
    const events = [];
    const task = (label, ms) => async () => {
      events.push(`${label}:start`);
      await delay(ms);
      events.push(`${label}:end`);
      return label;
    };

    const results = await Promise.all([
      enqueue(task('A', 30)),
      enqueue(task('B', 10)),
      enqueue(task('C', 20)),
    ]);

    // FIFO: A starts, A ends, B starts, B ends, C starts, C ends.
    // No interleaving even though B and C are shorter.
    expect(events).toEqual(['A:start', 'A:end', 'B:start', 'B:end', 'C:start', 'C:end']);
    expect(results).toEqual(['A', 'B', 'C']);
  });

  it('keeps draining past a failing task', async () => {
    const successFirst = enqueue(() => Promise.resolve('first'));
    const failure = enqueue(() => Promise.reject(new Error('mid-fail')));
    const successAfter = enqueue(() => Promise.resolve('after'));

    await expect(successFirst).resolves.toBe('first');
    await expect(failure).rejects.toThrow('mid-fail');
    // Queue must drain past the failure ; the next task still runs.
    await expect(successAfter).resolves.toBe('after');
  });

  it('handles synchronous throws inside the task', async () => {
    await expect(
      enqueue(() => {
        throw new Error('sync throw');
      }),
    ).rejects.toThrow('sync throw');
    // Queue not stuck — next call still works.
    await expect(enqueue(() => Promise.resolve(42))).resolves.toBe(42);
  });
});
