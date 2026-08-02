import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { authService } from '../../composition/container';
// eslint-disable-next-line import/no-restricted-paths -- pre-existing violation (#107): monitoring is cross-cutting and this background entry point has no hook to report through. Waived until error reporting is exposed as a port.
import { reportError, reportMessage } from '../../infrastructure/monitoring/sentry';
import { runCandidateSyncQuietly } from './candidateSync';

/**
 * Periodic candidate-photo sync, run by iOS while the app is closed.
 *
 * This is the third and least conditional of the sync triggers, and the reason
 * the other two are no longer load-bearing:
 *
 *  1. foreground (`useAutoSync`) — only when the user opens the app;
 *  2. silent push (`backgroundSync.ts`) — only when a posting is already due,
 *     and only if iOS is feeling generous about the app's background budget;
 *  3. this — iOS schedules it on its own, typically overnight while charging on
 *     wifi, which is exactly when uploading a day of photos is free.
 *
 * For a publisher posting every few days, (3) alone keeps the cloud set fresh
 * without them ever thinking about it. That is the goal: photos are just
 * synced, and nobody has to feel like they did something to make it happen.
 *
 * What still defeats all three: force-quitting the app from the app switcher.
 * iOS then refuses to relaunch it for background work of any kind until the app
 * is opened by hand. Nothing in this file (or any other) can work around that —
 * it is deliberate on Apple's part.
 */
export const PERIODIC_SYNC_TASK = 'follow-me-periodic-sync';

/**
 * How often to ask iOS to run this, in minutes. A floor, not a schedule: the
 * system coalesces background work into windows of its choosing and routinely
 * ignores short intervals. Asking every two hours costs nothing and buys more
 * chances of landing one; the posting cadence it feeds is measured in days.
 */
const MINIMUM_INTERVAL_MINUTES = 120;

TaskManager.defineTask(PERIODIC_SYNC_TASK, async () => {
  try {
    const publisherId = (await authService.getSession())?.user.id;
    // Signed out: nothing to sync, and no session to sync it under.
    if (publisherId == null) return BackgroundTask.BackgroundTaskResult.Success;
    // Nothing to show the user from a background task, but a failure here is
    // precisely what ends in an empty push — runCandidateSyncQuietly reports it.
    await runCandidateSyncQuietly(publisherId, 'periodic_sync_task');
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    reportError(err, 'periodic_sync_task');
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Call once at startup. Registration is persisted by the system, so re-running
 * it on every launch is a cheap no-op rather than a duplicate.
 *
 * Failure is reported and swallowed: background sync is an optimisation over
 * the foreground path, and an app that won't start because iOS declined to
 * schedule a task would be a far worse bug than photos syncing a bit later.
 */
export function registerPeriodicSync(): void {
  void BackgroundTask.registerTaskAsync(PERIODIC_SYNC_TASK, {
    minimumInterval: MINIMUM_INTERVAL_MINUTES,
  }).catch((err: unknown) => {
    reportError(err, 'register_periodic_sync');
  });
}

/**
 * iOS is about to suspend us mid-run. Nothing to unwind: the sync commits each
 * batch of three before starting the next, so whatever uploaded stays uploaded
 * and the next run resumes from there rather than restarting.
 *
 * Recorded as a message, not an error — being cut off is the normal shape of
 * background work, not a fault. It's here so that "the cloud set never fills
 * up" has a visible explanation in the field (windows too short to finish)
 * rather than looking like sync silently not running at all.
 */
BackgroundTask.addExpirationListener(() => {
  reportMessage('Background sync window expired', 'periodic_sync_expired');
});
