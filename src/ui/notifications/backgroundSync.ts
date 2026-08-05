import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { authService, reportError } from '../../composition/container';
import { runCandidateSyncQuietly } from '../data/candidateSync';
import { isSyncWakePayload } from '../../domain/services/syncWake';

/**
 * Background candidate sync, triggered by a silent push from the server.
 *
 * Cloud candidate photos are what the server posts from, and until this existed
 * they were only ever uploaded while the app was open. A publisher who didn't
 * open the app between two scheduled posts guaranteed an empty cloud set at
 * schedule time — which is how issue #97 produced a post notification carrying
 * no photos, no thumbnail, and no place.
 *
 * Now the posting job holds the slot open and sends a `content-available` push;
 * iOS wakes us here, we upload whatever is new, and the job's next tick finds
 * real photos and sends the real batch.
 *
 * Constraints this code lives under: no React, no navigation, no UI, and only a
 * few seconds of runtime before iOS suspends us again. The sync is batched and
 * resumable (each batch is committed before the next starts), so being cut off
 * mid-way costs nothing — the next wake or foreground picks up where it left off.
 */
export const SYNC_WAKE_TASK = 'follow-me-sync-candidates';

TaskManager.defineTask(SYNC_WAKE_TASK, async ({ data, error }) => {
  if (error != null) {
    reportError(error, 'sync_wake_task');
    return;
  }
  // The task fires for every background notification, including the rich
  // approval push. Only act on the server's explicit sync wake.
  if (!isSyncWakePayload(data)) return;

  try {
    const publisherId = (await authService.getSession())?.user.id;
    // Signed out: nothing to sync, and no session to sync it under.
    if (publisherId == null) return;
    // Nothing to show the user from a background task, but a failure here is
    // precisely what ends in an empty push — runCandidateSyncQuietly reports it.
    await runCandidateSyncQuietly(publisherId, 'sync_wake_task');
  } catch (err) {
    reportError(err, 'sync_wake_task');
  }
});

/** Call once at startup, before the root component mounts. */
export function registerBackgroundSyncTask(): void {
  void Notifications.registerTaskAsync(SYNC_WAKE_TASK).catch((err: unknown) => {
    reportError(err, 'register_sync_wake_task');
  });
}
