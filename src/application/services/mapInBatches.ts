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
   * Runs after each batch settles, before the next one starts — use it to
   * commit progress so an interrupted run resumes instead of restarting.
   */
  onBatch?: (results: R[], startIndex: number) => Promise<void>;
  /**
   * Checked before each batch. Returning true ends the run early and yields
   * only what has been processed so far. Long batched runs can outlive the
   * reason they were started (see SyncCandidatePhotosUseCase, where a cloud
   * wipe must not be undone by a sync that was already in flight).
   */
  shouldStop?: () => Promise<boolean>;
}

/**
 * Like `Promise.all(items.map(fn))`, but with at most `size` calls running at
 * once. Results come back in input order. An empty `items` resolves to `[]`
 * without calling `fn`, `onBatch` or `shouldStop`.
 *
 * A rejection (from `fn` or `onBatch`) propagates immediately and no further
 * batches start, leaving whatever `onBatch` already committed intact.
 */
export async function mapInBatches<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
  { onBatch, shouldStop }: BatchOptions<R> = {},
): Promise<R[]> {
  // A size of 0 would loop forever; a negative one would run backwards. Both
  // are caller bugs, and both are quieter to debug as a throw than as a hang.
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`mapInBatches: size must be a positive integer, got ${size}`);
  }
  const all: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    if (await shouldStop?.()) break;
    const batch = await Promise.all(items.slice(i, i + size).map((item, n) => fn(item, i + n)));
    await onBatch?.(batch, i);
    all.push(...batch);
  }
  return all;
}
