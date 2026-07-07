// Dynamic layer over app.json. Selects the app variant from APP_VARIANT (set per
// EAS build profile in eas.json) so production and staging install as SEPARATE
// apps — distinct bundle id, name, and URL scheme — and can live side by side on
// one device. Absent/unknown APP_VARIANT falls back to production, so a plain
// `expo` command with no variant set behaves exactly as before.
const VARIANTS = {
  production: {
    name: 'Follow Me',
    bundleIdentifier: 'com.followme.app',
    scheme: 'followme',
  },
  staging: {
    name: 'Follow Me (Staging)',
    bundleIdentifier: 'com.followme.app.staging',
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
  };
};
