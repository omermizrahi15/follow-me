/**
 * How many photo uploads may be in flight at once.
 *
 * Every upload decodes the full-resolution photo into a native bitmap (tens of
 * MB) to downscale it, so an unbounded `Promise.all` over a whole photo picker
 * selection — or a first sync's whole lookback window — spikes RAM by gigabytes
 * and the iOS watchdog kills the app (WatchdogTermination in Sentry, issues #77
 * and REACT-NATIVE-2). Three at a time keeps the peak flat while still
 * overlapping network latency.
 */
export const PHOTO_UPLOAD_BATCH_SIZE = 3;

/**
 * How many photos may have their asset metadata resolved at once.
 *
 * Cheaper than an upload — no bitmap is decoded — but not free: under "Optimise
 * iPhone Storage" resolving a `ph://` handle pulls the full-resolution original
 * down from iCloud, so a post's whole selection at once is still a spike of
 * concurrent downloads. Higher than the upload ceiling because the peak is disk
 * and network rather than RAM, and a post can now carry up to
 * MAX_PHOTOS_PER_POST photos.
 */
export const PHOTO_METADATA_BATCH_SIZE = 8;

export interface BatchOptions<R> {
  /**
   * Runs as results land, before the slot that produced them takes another
   * item — use it to commit progress so an interrupted run resumes instead of
   * restarting. Commits never overlap: anything that finishes while one is in
   * flight is handed to the next call, so a slow commit coalesces rather than
   * queueing up round trips. `done` counts results committed so far including
   * this call's, and only ever rises.
   */
  onCommit?: (results: R[], done: number) => Promise<void>;
  /**
   * Checked before each item is picked up. Returning true stops new items from
   * starting and yields only what has been processed so far. Long runs can
   * outlive the reason they were started (see SyncCandidatePhotosUseCase, where
   * a cloud wipe must not be undone by a sync that was already in flight).
   */
  shouldStop?: () => Promise<boolean>;
}

/**
 * Like `Promise.all(items.map(fn))`, but with at most `size` calls running at
 * once. Results come back in input order. An empty `items` resolves to `[]`
 * without calling `fn`, `onCommit` or `shouldStop`.
 *
 * A sliding window, not a barrier: a slot takes the next item the moment its
 * own finishes, so one slow photo (an iCloud original coming down over a bad
 * connection) no longer leaves the other slots idle waiting for it. Peak
 * concurrency is unchanged, which is the whole point of the ceiling — see
 * PHOTO_UPLOAD_BATCH_SIZE.
 *
 * A rejection (from `fn` or `onCommit`) propagates immediately and no further
 * items are picked up, leaving whatever `onCommit` already committed intact.
 * Items already in flight are awaited rather than abandoned — they hold native
 * bitmaps, and the ceiling only means anything if it counts them.
 */
export async function mapInBatches<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
  { onCommit, shouldStop }: BatchOptions<R> = {},
): Promise<R[]> {
  // A size of 0 would loop forever; a negative one would run backwards. Both
  // are caller bugs, and both are quieter to debug as a throw than as a hang.
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`mapInBatches: size must be a positive integer, got ${size}`);
  }
  if (items.length === 0) return [];

  // Written by index rather than pushed, so the returned order is the input
  // order however the completions interleave.
  const results: R[] = [];
  let nextIndex = 0;
  let stopped = false;

  // Results waiting to be committed, in completion order, plus the chain that
  // drains them one commit at a time.
  let pending: R[] = [];
  let committed = 0;
  let commits: Promise<void> = Promise.resolve();

  function commit(result: R): Promise<void> {
    if (onCommit == null) return Promise.resolve();
    pending.push(result);
    commits = commits.then(async () => {
      // An earlier link already took this result along with its own.
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      committed += batch.length;
      await onCommit(batch, committed);
    });
    const link = commits;
    // The awaiting worker is what surfaces a failed commit; this only keeps the
    // chain itself from counting as an unhandled rejection.
    link.catch(() => {});
    return link;
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (stopped) return;
      if (await shouldStop?.()) {
        stopped = true;
        return;
      }
      const index = nextIndex++;
      if (index >= items.length) return;
      // `noUncheckedIndexedAccess` can't see that the bound above makes this
      // safe, and `items` may legitimately hold undefined values.
      const item = items[index] as T;
      try {
        const result = await fn(item, index);
        results[index] = result;
        await commit(result);
      } catch (err) {
        // Whatever went wrong, nothing new should start behind it.
        stopped = true;
        throw err;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  // The last slot can finish while its commit is still draining.
  await commits;
  // Dense again: `results` is a prefix of `items` (workers take indices in
  // order), so an early stop leaves a shorter list, never a hole.
  return results.slice(0, Math.min(nextIndex, items.length));
}
