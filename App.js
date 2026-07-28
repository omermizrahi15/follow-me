import { registerRootComponent } from 'expo';
import * as Notifications from 'expo-notifications';
import { initErrorMonitoring, withErrorMonitoring } from './src/infrastructure/monitoring/sentry';
import { AppNavigator } from './src/ui/navigation/AppNavigator';
import { registerNotificationCategories } from './src/infrastructure/notifiers/NotificationCategories';
import { cacheBatchFromNotification } from './src/ui/notifications/cacheApprovalBatch';
import { handlePostNowResponse } from './src/ui/notifications/postNow';

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