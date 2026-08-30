/**
 * Guards that the Expo app config still *evaluates* — every config plugin named
 * in `app.config.js` resolves and loads.
 *
 * Nothing in `npm run validate` ever built the config, so the first thing to
 * evaluate it was `eas update` on main, minutes after merge. That is how #172
 * shipped a broken deploy: regenerating the lockfile bumped `expo` 54.0.35 →
 * 54.0.37, whose exact `@expo/cli` pin pushed `@expo/prebuild-config` down into
 * `node_modules/expo/node_modules/@expo/cli/node_modules/`. `@bacons/apple-targets`
 * deep-requires that package without declaring it, so once it stopped being
 * hoisted the plugin threw, `expo config --json --type public` exited 1, and
 * eas-cli reported only "update command failed" — the underlying error never
 * reached the log. A hoisting change in a transitive dependency is invisible in
 * every other check we run; this makes it fail in `npm test` instead.
 *
 * `isPublicConfig` mirrors the `--type public` the deploy uses, so this exercises
 * the same code path (`withConfigPlugins`) that broke.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getConfig } = require('@expo/config') as {
  getConfig: (
    projectRoot: string,
    options: { skipSDKVersionRequirement?: boolean; isPublicConfig?: boolean },
  ) => { exp: { plugins?: unknown[] } };
};

import path from 'path';

const repoRoot = path.join(__dirname, '..');

const readConfig = (): { exp: { plugins?: unknown[] } } =>
  getConfig(repoRoot, { skipSDKVersionRequirement: true, isPublicConfig: true });

describe('expo app config', () => {
  it('evaluates with every config plugin resolved', () => {
    expect(() => readConfig()).not.toThrow();
  });

  it('still declares the plugins the native build depends on', () => {
    // Named explicitly: an unresolvable plugin throws above, but a plugin quietly
    // dropped from app.config.js would leave a config that still evaluates while
    // the next build silently loses its iOS extensions or crash reporting.
    const plugins = (readConfig().exp.plugins ?? []).map((p) =>
      Array.isArray(p) ? (p[0] as string) : (p as string),
    );

    expect(plugins).toEqual(
      expect.arrayContaining(['@bacons/apple-targets', '@sentry/react-native/expo']),
    );
  });
});
