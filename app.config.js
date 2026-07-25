// Dynamic layer over app.json. Selects the app variant from APP_VARIANT (set per
// EAS build profile in eas.json) so production and staging install as SEPARATE
// apps — distinct bundle id, name, and URL scheme — and can live side by side on
// one device. Absent/unknown APP_VARIANT falls back to production, so a plain
// `expo` command with no variant set behaves exactly as before.
const VARIANTS = {
  production: {
    name: 'Follow Me',
    // com.followme.app is taken by another Apple account (bundle ids are global);
    // use the project's own reverse-domain namespace instead.
    bundleIdentifier: 'com.urishiber.followme',
    scheme: 'followme',
  },
  staging: {
    name: 'Follow Me (Staging)',
    bundleIdentifier: 'com.urishiber.followme.staging',
    scheme: 'followmestaging',
  },
};

module.exports = ({ config }) => {
  const variant = process.env.APP_VARIANT === 'staging' ? 'staging' : 'production';
  const v = VARIANTS[variant];
  return {
    ...config,
    name: v.name,
    scheme: v.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: v.bundleIdentifier,
    },
    plugins: [
      ...(config.plugins ?? []),
      // Rich approval push (issue #71): adds two iOS app-extension targets from
      // ./targets during prebuild — a NotificationServiceExtension that attaches
      // the lead photo as the collapsed thumbnail, and a NotificationContent
      // Extension that renders the whole batch as a gallery when the push is
      // expanded. Their bundle ids are relative ('.notificationservice') so they
      // inherit the per-variant app bundle id above. Requires a native build to
      // take effect (no-op in Expo Go).
      '@bacons/apple-targets',
      // Crash reporting (issue #10): wires the native Sentry SDK and hooks the
      // build so source maps + debug symbols upload during `eas build`. Org and
      // project come from SENTRY_ORG / SENTRY_PROJECT (EAS env vars) so nothing
      // account-specific is hardcoded; upload needs SENTRY_AUTH_TOKEN too.
      [
        '@sentry/react-native/expo',
        {
          organization: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
        },
      ],
    ],
    // EAS Update (over-the-air JS updates). Both variants share one EAS project
    // and update URL; the per-profile `channel` in eas.json routes production vs
    // staging.
    updates: {
      ...config.updates,
      url: 'https://u.expo.dev/9e70e6a6-2576-46ae-8160-8703a967f22c',
    },
    // runtimeVersion gates which native builds an OTA update can be delivered to.
    // The `fingerprint` policy derives it from a hash of the native project
    // (config, native modules, deps) instead of the app version, so an OTA is
    // only sent to builds it's actually compatible with. This closes the gap
    // behind the staging WatchdogTermination boot loop (Sentry REACT-NATIVE-2):
    // under the old `appVersion` policy every 1.0.0 build shared runtimeVersion
    // "1.0.0", so a build with an outdated embedded bundle could keep launching
    // and crashing before an OTA could heal it. IMPORTANT: this only takes effect
    // via a native rebuild — it must ship WITH an `eas build`, never as an OTA
    // hotfix (it retags updates and would strand installed appVersion=1.0.0
    // builds). See src/application/usecases/SyncCandidatePhotosUseCase.ts (PR #69).
    runtimeVersion: {
      policy: 'fingerprint',
    },
  };
};
