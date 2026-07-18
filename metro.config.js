// Sentry's wrapper over the default Expo Metro config: injects debug IDs into
// bundles + source maps so uploaded maps match the exact bundle a crash came
// from (issue #10). Behaves identically to the stock config otherwise.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
