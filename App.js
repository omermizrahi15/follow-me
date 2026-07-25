import { registerRootComponent } from 'expo';
import * as Notifications from 'expo-notifications';
import { initErrorMonitoring, withErrorMonitoring } from './src/infrastructure/monitoring/sentry';
import { AppNavigator } from './src/ui/navigation/AppNavigator';
import { registerNotificationCategories } from './src/infrastructure/notifiers/NotificationCategories';
import { cacheBatchFromNotification } from './src/ui/notifications/cacheApprovalBatch';

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

// Sentry's wrapper adds an error boundary around the root so React render
// errors are captured with component context.
registerRootComponent(withErrorMonitoring(AppNavigator));