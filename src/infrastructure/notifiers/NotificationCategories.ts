import * as Notifications from 'expo-notifications';
import { POST_NOW_ACTION } from '../../domain/services/postNowAction';

export { POST_NOW_ACTION };
export const REVIEW_ACTION = 'REVIEW';
export const POST_REVIEW_CATEGORY = 'post-review';

/**
 * Registers the "Post now" / "Review" action buttons on the post-reminder
 * notification. Must be called before the first notification fires — call once
 * at app startup (before registerRootComponent).
 */
export async function registerNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(POST_REVIEW_CATEGORY, [
    {
      identifier: POST_NOW_ACTION,
      buttonTitle: 'Post now',
      // "Post now" means *now*, without a detour through the app. iOS launches
      // us in the background to deliver the response; the handler fires one
      // call to /post-batch and the server does the fan-out from the photos it
      // already has in the cloud. A confirmation push follows when it lands.
      options: { opensAppToForeground: false },
    },
    {
      identifier: REVIEW_ACTION,
      buttonTitle: 'Review',
      options: { opensAppToForeground: true },
    },
  ]);
}
