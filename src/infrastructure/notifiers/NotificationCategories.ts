import * as Notifications from 'expo-notifications';

export const POST_NOW_ACTION = 'POST_NOW';
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
      options: { opensAppToForeground: true },
    },
    {
      identifier: REVIEW_ACTION,
      buttonTitle: 'Review',
      options: { opensAppToForeground: true },
    },
  ]);
}
