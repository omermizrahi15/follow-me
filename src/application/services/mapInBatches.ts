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
 * Like `Promise.all(items.map(fn))`, but with at most `size` calls running at
 * once. Results come back in input order.
 *
 * `onBatch` runs after each batch settles, before the next one starts — use it
 * to commit progress so an interrupted run resumes instead of restarting. A
 * rejection (from `fn` or `onBatch`) propagates immediately and no further
 * batches start, leaving whatever `onBatch` already committed intact.
 */
export async function mapInBatches<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
  onBatch?: (results: R[], startIndex: number) => Promise<void>,
): Promise<R[]> {
  const all: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = await Promise.all(items.slice(i, i + size).map((item, n) => fn(item, i + n)));
    await onBatch?.(batch, i);
    all.push(...batch);
  }
  return all;
}
