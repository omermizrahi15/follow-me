/**
 * NotificationServiceExtension target (issue #71).
 *
 * Intercepts the "batch ready to review" push (sent with `mutableContent: true`
 * by the auto-post edge function), downloads the lead photo from `imageUrl`, and
 * attaches it so iOS shows it as the collapsed thumbnail and enlarges it on
 * long-press. A relative bundle id keeps prod/staging variants working.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'notification-service',
  name: 'NotificationService',
  bundleIdentifier: '.notificationservice',
  deploymentTarget: '15.1',
};
