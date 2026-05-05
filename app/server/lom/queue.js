'use strict';

// Sequential LOM queue — only ONE outlet → response cycle in flight at a time.
// Why: Max [js] resolves outlet messages on its own thread and we match
// responses by id ; running concurrent ops in parallel would still work
// today, but it makes the model fragile against any future state-mutation
// chain (e.g. multi-step "delete then add" sequences). Serializing here
// keeps the contract simple and predictable for callers.

const queue = [];
let busy = false;

/**
 * Schedule an async task to run when the LOM is idle. The returned promise
 * settles with the task's result (or rejection). FIFO ordering.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drain();
  });
}

/**
 * Internal dispatcher: run the next queued task when idle, then chain to the
 * one after. The `Promise.resolve().then(task)` wrapping isolates synchronous
 * throws from a buggy task — without it, a throw before the task returns its
 * promise would crash the dispatcher and leave busy=true forever.
 */
function drain() {
  if (busy || queue.length === 0) return;
  busy = true;
  const { task, resolve, reject } = queue.shift();
  // Wrap the task call in Promise.resolve().then(task) so synchronous throws
  // (a buggy task that throws before returning a promise) get routed to the
  // .catch arm rather than crashing the dispatcher and leaving the queue
  // stuck with busy=true.
  Promise.resolve()
    .then(task)
    .then((value) => {
      busy = false;
      resolve(value);
      drain();
    })
    .catch((err) => {
      busy = false;
      reject(err);
      drain();
    });
}

module.exports = { enqueue };
