// Sentry's wrapper over the default Expo Metro config: injects debug IDs into
// bundles + source maps so uploaded maps match the exact bundle a crash came
// from (issue #10). Behaves identically to the stock config otherwise.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// Rewrite top-level `require`s into the places they are first used, so a module
// is evaluated when something actually reaches for it rather than when the
// bundle loads. Launch only pays for what the first screen touches, which is
// worth more here than usual: the composition root wires the whole app at
// import time (#115), and half the screens are behind a nav stack nobody opens
// in the first second.
//
// The one rule this changes: a module's side effects now run at first use, not
// at bundle load. Nothing in `src/` relies on import-time side effects ordering
// — the Sentry init, the notification handlers and the background task
// registration are all explicit calls from App.js.
// Delegates to Expo's own options and flips the one flag, so whatever else it
// decides per-platform (experimentalImportSupport, and anything it adds later)
// keeps applying.
const expoTransformOptions = config.transformer.getTransformOptions;
config.transformer = {
  ...config.transformer,
  getTransformOptions: async (...args) => {
    const options = await expoTransformOptions(...args);
    return { ...options, transform: { ...options.transform, inlineRequires: true } };
  },
};

module.exports = config;
