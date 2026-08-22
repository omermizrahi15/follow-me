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

/**
 * Resolves after `ms`, or as soon as `signal` aborts — the default backoff
 * wait.
 *
 * Interruptible because a backoff outlives the reason for it more often than
 * you would think: the photo classifier abandons a run on its first failure,
 * and without this the three siblings still in flight each sit out a wait for a
 * retry whose answer has already been discarded.
 */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = release(setTimeout(finish, ms));
    signal?.addEventListener('abort', finish);
  });
