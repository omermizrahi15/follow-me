/**
 * The timer seam.
 *
 * Anything that waits — the connectivity monitor settling a flap, an HTTP
 * request giving up — takes these as options so its tests can drive time by
 * hand instead of sleeping. Shared so the two do not each invent the type, and
 * so the `number`-vs-`Timeout` split between React Native and Node is written
 * down once.
 */

/** Opaque timer id: a `number` on React Native, a `Timeout` under Node. */
export type TimerHandle = ReturnType<typeof setTimeout> | number;

export type Schedule = (fn: () => void, ms: number) => TimerHandle;
export type Cancel = (handle: TimerHandle) => void;

/**
 * Node keeps the process alive for every pending timer; React Native's
 * `setTimeout` returns a plain number and has no such notion. A request
 * deadline is a backstop, never a reason to stay up, so release it where the
 * runtime understands that — which is also what stops a 60s upload deadline
 * from holding a finished jest worker open.
 */
function release(handle: TimerHandle): TimerHandle {
  (handle as { unref?: () => void }).unref?.();
  return handle;
}

export const scheduleTimer: Schedule = (fn, ms) => release(setTimeout(fn, ms));
export const cancelTimer: Cancel = handle => clearTimeout(handle);

/** Resolves after `ms`. The default backoff wait. */
export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    release(setTimeout(resolve, ms));
  });
