import { registerRootComponent } from 'expo';
import * as Notifications from 'expo-notifications';
import { initErrorMonitoring, withErrorMonitoring } from './src/infrastructure/monitoring/sentry';
import { AppNavigator } from './src/ui/navigation/AppNavigator';
import { registerNotificationCategories } from './src/infrastructure/notifiers/NotificationCategories';
import { cacheBatchFromNotification } from './src/ui/notifications/cacheApprovalBatch';
import { handlePostNowResponse } from './src/ui/notifications/postNow';
import { registerBackgroundSyncTask } from './src/ui/notifications/backgroundSync';
import { registerPeriodicSync } from './src/ui/data/periodicSync';
import { restoreLastSyncedAt } from './src/ui/data/syncStatus';

// Crash reporting first, before the root component mounts — everything that
// fails past this line (JS exceptions, native crashes) is captured. No-op in
// local dev; only EAS preview/production builds report (issue #10).
initErrorMonitoring();

// Show notifications even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Register "Post now" / "Review" action buttons (must run before first notification).
void registerNotificationCategories();

// The server's silent "sync your photos" push (issue #97) wakes the app here,
// with no UI, so the cloud photo set is fresh when the posting job runs even if
// the app hasn't been opened in days. Registered at module scope for the same
// reason as the "Post now" handler below: iOS may launch us in the background
// purely to deliver it, long before React mounts.
registerBackgroundSyncTask();

// The same sync, but on iOS's own schedule rather than the server's — it runs
// while the app is closed, typically overnight on charge, so the cloud photo
// set stays fresh without the user ever opening the app or pressing anything.
// Registered at module scope for the same reason: iOS launches us straight into
// the task, with no React in sight.
registerPeriodicSync();

// "Last synced" is shown in the settings UI and outlives the process that wrote
// it, so it is read back from storage before anything can render.
void restoreLastSyncedAt();

// When a server push arrives (foreground), resolve the batch into the cache
// (by batchId — see issue #71) so the review screen can skip scanning when the
// user taps the notification.
Notifications.addNotificationReceivedListener(notification => {
  void cacheBatchFromNotification(notification.request.content.data);
});

// "Post now" is handled here, at module scope, rather than in the navigator:
// the action no longer brings the app to the foreground, so iOS may launch us
// in the background purely to deliver the response and the handler has to be
// listening before React (and the auth context it waits on) has mounted.
Notifications.addNotificationResponseReceivedListener(response => {
  void handlePostNowResponse(response);
});
// Replay on launch: if the background launch was killed before the request
// went out, the pending response is still here the next time the app starts.
// Both paths dedupe on batchId, so the double delivery costs nothing.
void Notifications.getLastNotificationResponseAsync().then(handlePostNowResponse);

// Sentry's wrapper adds an error boundary around the root so React render
// errors are captured with component context.
registerRootComponent(withErrorMonitoring(AppNavigator));