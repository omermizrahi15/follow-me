import { loadConfig, recordCandidateSync, syncCandidatePhotos } from '../../composition/container';
import { reportError } from '../../infrastructure/monitoring/sentry';
import { hasPhotoSyncConsent, isPhotoSyncPaused } from './photoSyncConsent';

/**
 * The one way the app refreshes its cloud candidate photos.
 *
 * Shared by the foreground hook (`useAutoSync`) and the background notification
 * task, so both honour the same gates and — importantly — both leave the same
 * heartbeat behind. The server's posting job reads that heartbeat to tell "this
 * publisher has no new photos" from "this phone hasn't checked in", which is
 * what issue #97 could not distinguish.
 */
export type CandidateSyncOutcome =
  /** Sync ran to completion (uploading zero photos still counts — nothing new is a valid answer). */
  | 'synced'
  /** The user has never agreed to photo upload. */
  | 'no-consent'
  /** Sync is suspended after a "Remove my photos from the cloud" wipe. */
  | 'paused';

/**
 * Throws if the sync itself fails — callers decide whether that's fatal, but
 * they must not swallow it silently: a sync that fails without a trace is how
 * issue #97 went unnoticed until it produced an empty push three days later.
 * `runCandidateSyncQuietly` is the swallow-but-report version.
 *
 * Pass `lookbackDays` when the caller already has the config in hand (it just
 * saved it) to skip the reload.
 */
export async function runCandidateSync(
  publisherId: string,
  lookbackDays?: number,
): Promise<CandidateSyncOutcome> {
  if (!(await hasPhotoSyncConsent())) return 'no-consent';
  if (await isPhotoSyncPaused()) return 'paused';

  const days = lookbackDays ?? (await loadConfig.execute(publisherId)).lookbackDays;
  // isPhotoSyncPaused is re-checked between upload batches, not just here: a
  // sync over a large library runs for a while, and a wipe partway through must
  // not be undone by batches still in flight.
  await syncCandidatePhotos.execute(publisherId, days, isPhotoSyncPaused);

  // Heartbeat last, and only on success — a failed sync must read as "this
  // phone is not syncing", which is exactly what a missing heartbeat means.
  // Its own failure doesn't invalidate the upload, so it's reported, not thrown.
  try {
    await recordCandidateSync(publisherId);
  } catch (err) {
    reportError(err, 'record_candidate_sync');
  }

  return 'synced';
}

/**
 * For callers that can't act on a failure (a background task, or a Save the
 * user already considers finished). Never rejects — but never silent either:
 * the failure lands in Sentry tagged with `operation`, so "the cloud set is
 * empty" always has a traceable cause instead of surfacing days later as an
 * empty push.
 */
export async function runCandidateSyncQuietly(
  publisherId: string,
  operation: string,
  lookbackDays?: number,
): Promise<void> {
  try {
    await runCandidateSync(publisherId, lookbackDays);
  } catch (err) {
    reportError(err, operation);
  }
}
