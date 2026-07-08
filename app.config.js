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
    // EAS Update (over-the-air JS updates). Both variants share one EAS project
    // and update URL; the per-profile `channel` in eas.json routes production vs
    // staging. runtimeVersion tracks the app version so a native rebuild is only
    // needed when native code changes.
    updates: {
      ...config.updates,
      url: 'https://u.expo.dev/9e70e6a6-2576-46ae-8160-8703a967f22c',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
  };
};
