import { registerRootComponent } from 'expo';
import * as Notifications from 'expo-notifications';
import { AppNavigator } from './src/ui/navigation/AppNavigator';
import { registerNotificationCategories } from './src/infrastructure/notifiers/NotificationCategories';
import { SuggestionCache } from './src/infrastructure/cache/SuggestionCache';

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

// When a server push arrives (foreground), immediately cache the pre-computed batch
// so the review screen can skip scanning when the user taps the notification.
Notifications.addNotificationReceivedListener(notification => {
  const d = notification.request.content.data;
  if (d != null && typeof d.publisherId === 'string' && Array.isArray(d.batch)) {
    void SuggestionCache.save({
      publisherId: d.publisherId,
      batch: d.batch,
      pool: Array.isArray(d.pool) ? d.pool : [],
      batchId: typeof d.batchId === 'string' ? d.batchId : String(Date.now()),
      cachedAt: Date.now(),
    });
  }
});

registerRootComponent(AppNavigator);