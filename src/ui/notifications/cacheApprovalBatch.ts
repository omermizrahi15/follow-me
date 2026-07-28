import { SuggestionCache } from '../../infrastructure/cache/SuggestionCache';
import { fetchApprovalBatch } from '../../composition/container';

/** The subset of an approval push's `data` the app needs to resolve the batch. */
export interface ReviewNotificationData {
  screen?: string;
  publisherId?: string;
  batch?: unknown[];
  pool?: unknown[];
  batchId?: string;
  /** Set only on the "Posted ✅" push — the posting to open, not a batch to review. */
  postingId?: string;
}

/**
 * Populate SuggestionCache for the review screen from an approval notification,
 * so it opens the server-computed batch instead of rescanning the device.
 *
 * The rich push now carries only `batchId` — the full batch/pool live server-side
 * to keep the push under the APNs 4KB limit (issue #71) — so we fetch by id.
 * Older pushes still in flight embed `batch`/`pool` inline; that path is kept as
 * a fallback. Best-effort throughout: on any miss the screen falls back to a scan.
 */
export async function cacheBatchFromNotification(
  data: ReviewNotificationData | undefined,
): Promise<void> {
  if (data?.publisherId == null) return;

  if (Array.isArray(data.batch)) {
    await SuggestionCache.save({
      publisherId: data.publisherId,
      batch: data.batch as never,
      pool: Array.isArray(data.pool) ? (data.pool as never) : [],
      batchId: data.batchId ?? String(Date.now()),
      cachedAt: Date.now(),
    });
    return;
  }

  if (data.batchId == null) return;
  try {
    const fetched = await fetchApprovalBatch(data.batchId);
    if (fetched == null) return;
    await SuggestionCache.save({
      publisherId: data.publisherId,
      batch: fetched.batch,
      pool: fetched.pool,
      batchId: data.batchId,
      cachedAt: Date.now(),
    });
  } catch {
    // Network/row miss — leave the cache empty so the screen rescans the device.
  }
}
