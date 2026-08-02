/**
 * Collapses concurrent calls into the one already running.
 *
 * Candidate-photo sync now has four independent triggers — app launch, return
 * to foreground, iOS's background schedule, and the server's silent wake push —
 * and nothing stops two firing at once (a background task can start seconds
 * before the user opens the app). Two concurrent runs each see the same "not
 * yet uploaded" set and upload all of it twice: double the bandwidth, and
 * double the peak RAM of decoding full-resolution photos, which is exactly the
 * watchdog kill from issue #77.
 *
 * Callers that arrive mid-run join it instead of starting a second one. That is
 * the right semantics here rather than queueing: a run that started moments ago
 * reads the same photo library, so a pass right behind it would find nothing
 * new anyway.
 *
 * Arguments of a joining call are ignored — it receives the in-flight run's
 * result. Only use this where later callers genuinely want "whatever the run in
 * progress produces", not their own parameterised answer.
 */
export function singleFlight<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  let inFlight: Promise<R> | null = null;
  return (...args: A): Promise<R> => {
    // Cleared in `finally`, so a rejected run doesn't wedge every later call —
    // the next caller starts a fresh attempt rather than re-receiving the error.
    inFlight ??= fn(...args).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
