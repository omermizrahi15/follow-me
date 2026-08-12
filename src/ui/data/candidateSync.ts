import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadConfig,
  pruneUploadedPhotos,
  recordSyncState,
  reportError,
  syncCandidatePhotos,
} from '../../composition/container';
import { singleFlight } from '../../application/services/singleFlight';
import { isPhotoSyncEnabled } from './photoSyncConsent';
import { syncBlocked, syncFailed, syncFinished, syncProgressed, syncStarted } from './syncStatus';

/**
 * The one way the app refreshes its cloud candidate photos.
 *
 * Shared by the foreground hook (`useAutoSync`), the background task, and the
 * silent-push wake, so every trigger honours the same gates and — importantly —
 * all leave the same trail behind: a heartbeat for the server, and observable
 * state for the UI. The server's posting job reads the heartbeat to tell "this
 * publisher has no new photos" from "this phone hasn't checked in", which is
 * what issue #97 could not distinguish.
 */
export type CandidateSyncOutcome =
  /** Sync ran to completion (uploading zero photos still counts — nothing new is a valid answer). */
  | 'synced'
  /** Photo upload is switched off — never agreed to, or withdrawn by a cloud wipe. */
  | 'no-consent';

/**
 * Throws if the sync itself fails — callers decide whether that's fatal, but
 * they must not swallow it silently: a sync that fails without a trace is how
 * issue #97 went unnoticed until it produced an empty push three days later.
 * `runCandidateSyncQuietly` is the swallow-but-report version.
 *
 * Pass `lookbackDays` when the caller already has the config in hand (it just
 * saved it) to skip the reload.
 *
 * Wrapped in `singleFlight` because there are now four independent triggers
 * (launch, foreground, iOS background schedule, silent wake push) and nothing
 * stops two overlapping — see that module for why a double run is worse than a
 * skipped one.
 */
export const runCandidateSync: (
  publisherId: string,
  lookbackDays?: number,
) => Promise<CandidateSyncOutcome> = singleFlight(syncOnce);

/**
 * Days a cloud copy outlives the window it was uploaded for.
 *
 * Nothing outside the lookback can be selected for a post, so an older copy is
 * dead weight the publisher never asked us to keep — but a pending approval
 * batch still points at its photos, and deleting the assets under it would
 * leave the push with broken thumbnails. A week covers every cadence's
 * approval round-trip.
 */
const RETENTION_GRACE_DAYS = 7;

/** Shortest gap between retention passes — see `pruneAgedOut`. */
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_PRUNE_KEY = 'photo-prune-last-run-v1';

async function syncOnce(
  publisherId: string,
  lookbackDays?: number,
): Promise<CandidateSyncOutcome> {
  if (!(await isPhotoSyncEnabled())) return blocked(publisherId, 'no-consent');

  const days = lookbackDays ?? (await loadConfig.execute(publisherId)).lookbackDays;
  try {
    // Consent is re-checked between upload batches, not just here: a sync over a
    // large library runs for a while, and a wipe partway through must not be
    // undone by batches still in flight.
    await syncCandidatePhotos.execute(
      publisherId,
      days,
      async () => !(await isPhotoSyncEnabled()),
      (uploaded, total) => (uploaded === 0 ? syncStarted(total) : syncProgressed(uploaded)),
    );
  } catch (err) {
    // Surfaced in the UI as well as thrown: an upload that keeps failing looks
    // identical to one that never started, and the user is the only one who can
    // act on "no network" or "storage full".
    syncFailed(err instanceof Error ? err.message : 'Photo upload failed');
    throw err;
  }
  syncFinished(Date.now());

  await pruneAgedOut(days);

  // Reported last, and only on success — a failed sync must read as "this phone
  // is not syncing", which is exactly what a missing heartbeat means. Its own
  // failure doesn't invalidate the upload, so it's reported, not thrown.
  await reportState(publisherId, 'active');
  return 'synced';
}

/**
 * Delete cloud copies that have aged out of the window, at most once a day.
 *
 * The cloud set was only ever meant to hold the lookback window, but nothing
 * removed a photo once it fell out of one — so the private copies accumulated
 * forever, and the only thing that ever shrank them was the publisher finding a
 * "remove my photos" link and pressing it. That is not a job to hand to the
 * user.
 *
 * Throttled because sync runs on every foreground and this is a server round
 * trip that finds nothing to do the vast majority of the time. A day's worth of
 * stale copies is storage, not a defect — whereas a request per app switch is.
 *
 * Best-effort throughout: a failed prune costs storage, never a post.
 */
async function pruneAgedOut(lookbackDays: number): Promise<void> {
  try {
    const last = Number(await AsyncStorage.getItem(LAST_PRUNE_KEY)) || 0;
    if (Date.now() - last < PRUNE_INTERVAL_MS) return;
    await pruneUploadedPhotos(lookbackDays + RETENTION_GRACE_DAYS);
    // Stamped only after it worked, so a failing prune is retried on the next
    // sync rather than skipped for a day.
    await AsyncStorage.setItem(LAST_PRUNE_KEY, String(Date.now()));
  } catch (err) {
    reportError(err, 'prune_candidate_photos');
  }
}

/**
 * Photo upload is switched off on this device. Tell the UI (so the user can see
 * it and turn it back on) and the server (so it stops holding posting slots open
 * for photos that cannot arrive, and stops advising the user to open an app that
 * is already open).
 */
async function blocked(
  publisherId: string,
  outcome: 'no-consent',
): Promise<CandidateSyncOutcome> {
  syncBlocked(outcome);
  await reportState(publisherId, outcome);
  return outcome;
}

/** Best-effort: the state report is telemetry for the server, never the point of the sync. */
async function reportState(
  publisherId: string,
  state: 'active' | 'paused' | 'no-consent',
): Promise<void> {
  try {
    await recordSyncState(publisherId, state);
  } catch (err) {
    reportError(err, 'record_sync_state');
  }
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
