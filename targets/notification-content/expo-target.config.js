/**
 * NotificationContentExtension target (issue #71).
 *
 * Binds to the `post-review` notification category and renders the whole photo
 * batch (from `data.batch`) as a grid when the "batch ready to review" push is
 * expanded — so the publisher can see every photo without opening the app. The
 * category binding + extension keys live in the sibling Info.plist.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'notification-content',
  name: 'NotificationContent',
  bundleIdentifier: '.notificationcontent',
  deploymentTarget: '15.1',
};
