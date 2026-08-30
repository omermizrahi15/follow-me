// Sentry's wrapper over the default Expo Metro config: injects debug IDs into
// bundles + source maps so uploaded maps match the exact bundle a crash came
// from (issue #10). Behaves identically to the stock config otherwise.
const path = require('path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// ── Dev-only tooling is dropped at resolution time ──────────────────────────
//
// `src/ui/dev/DevNotificationPanel.tsx` is the "fire a test approval push"
// panel: a few hundred lines of diagnostics plus a list of picsum.photos
// sample images. It used to be gated by a runtime boolean (`__DEV__ ||
// APP_VARIANT === 'staging'`), which hid the buttons and shipped every line of
// it — Metro builds its dependency graph from `require` calls long before any
// minifier sees the dead branch, so a runtime flag can never remove a module
// from a bundle.
//
// Resolution can. In a production bundle every import of the panel resolves to
// a stub that renders null, so the real module is never reached and never
// walked. Verify with:
//   npx expo export --platform ios && grep -r picsum.photos dist/   # no hits
//
// `src/ui/dev/AiUsageBar.tsx` is the same idea for the daily AI budget: a
// read-out of how much of the classify quota is left, for whoever is testing
// staging. It pulls in a hook and a quota request that a production build has
// no caller for.
//
// `src/ui/dev/PhotoGradeInspector.tsx` is the grade inspector: every photo the
// AI has graded, ranked by the same score the post is chosen with, with the
// factor arithmetic and the model's own reasoning beside each one. It is the
// heaviest of the three — a screen, a hook, a use case and a thumbnail list —
// and it exists to explain the algorithm to whoever is tuning it, which is not
// a job a publisher's build has.
//
// Add a module here by adding its real path and its `.prod.tsx` stub to
// DEV_ONLY_MODULES — and a case to src/devToolsBundling.test.ts, which is what
// notices when a rename silently switches the rule off.
const devOnly = name => [
  path.join(__dirname, `src/ui/dev/${name}.tsx`),
  path.join(__dirname, `src/ui/dev/${name}.prod.tsx`),
];
const DEV_ONLY_MODULES = new Map([
  devOnly('DevNotificationPanel'),
  devOnly('AiUsageBar'),
  devOnly('PhotoGradeInspector'),
]);

// Staging keeps the tooling on purpose: QA triggers the rich approval push from
// a real staging device. Everything else — `expo export`, an EAS production or
// preview build, a local Release build — gets the stub. Mirrors the runtime
// `showDevTools` rule in src/ui/data/devTools.ts, which stays as a second line
// of defence for the bundles that do include the module.
const includeDevTools =
  process.env.NODE_ENV !== 'production' || process.env.EXPO_PUBLIC_APP_VARIANT === 'staging';

if (!includeDevTools) {
  config.resolver = {
    ...config.resolver,
    resolveRequest: (context, moduleName, platform) => {
      const resolved = context.resolveRequest(context, moduleName, platform);
      const stub =
        resolved.type === 'sourceFile' ? DEV_ONLY_MODULES.get(resolved.filePath) : undefined;
      if (stub !== undefined) return { type: 'sourceFile', filePath: stub };
      return resolved;
    },
  };
}

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
