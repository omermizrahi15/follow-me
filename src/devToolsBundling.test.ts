/**
 * Guards the rule that keeps dev-only tooling out of a production bundle.
 *
 * The runtime `showDevTools` boolean shipped ~250 lines of test-notification
 * code — and a list of picsum.photos sample URLs — in every production build
 * for months, because Metro builds its dependency graph from `require` calls
 * long before any minifier sees the dead branch (#118). The fix is a resolver
 * swap in `metro.config.js`, and this asserts the swap actually fires.
 *
 * The direct test is `npx expo export && grep picsum dist/`, which takes three
 * minutes. This is the same claim in two seconds; run the export when the
 * resolver logic itself changes.
 */
import fs from 'fs';
import path from 'path';

const repoRoot = path.join(__dirname, '..');
const DEV_PANEL = path.join(repoRoot, 'src/ui/dev/DevNotificationPanel.tsx');
const DEV_PANEL_STUB = path.join(repoRoot, 'src/ui/dev/DevNotificationPanel.prod.tsx');

interface Resolution { type: string; filePath?: string }
interface Resolver {
  (context: unknown, moduleName: string, platform: string | null): Resolution;
}

/** Load metro.config.js under a given build environment. */
function resolverFor(env: Record<string, string | undefined>): Resolver | null {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require('../metro.config.js') as {
      resolver: { resolveRequest?: Resolver | null };
    };
    return config.resolver.resolveRequest ?? null;
  } finally {
    process.env = saved;
  }
}

/** A resolution context whose default resolver always finds `filePath`. */
function contextFinding(filePath: string): { resolveRequest: Resolver } {
  return { resolveRequest: () => ({ type: 'sourceFile', filePath }) };
}

function resolve(resolver: Resolver | null, filePath: string): string | undefined {
  if (resolver == null) return filePath; // no swap installed — the default wins
  const context = contextFinding(filePath);
  return resolver(context, './DevNotificationPanel', 'ios').filePath;
}

describe('dev notification tooling', () => {
  it('is swapped for the stub in a production bundle', () => {
    const resolver = resolverFor({ NODE_ENV: 'production', EXPO_PUBLIC_APP_VARIANT: 'production' });

    expect(resolve(resolver, DEV_PANEL)).toBe(DEV_PANEL_STUB);
  });

  it('is swapped for the stub when no variant is set at all', () => {
    // A plain `expo export` / local Release build. The old rule shipped the
    // tooling here too, since __DEV__ was the only thing switching it off.
    const resolver = resolverFor({ NODE_ENV: 'production', EXPO_PUBLIC_APP_VARIANT: undefined });

    expect(resolve(resolver, DEV_PANEL)).toBe(DEV_PANEL_STUB);
  });

  it('is kept on staging, where QA triggers the real approval push', () => {
    const resolver = resolverFor({ NODE_ENV: 'production', EXPO_PUBLIC_APP_VARIANT: 'staging' });

    expect(resolve(resolver, DEV_PANEL)).toBe(DEV_PANEL);
  });

  it('is kept for the dev server', () => {
    const resolver = resolverFor({ NODE_ENV: 'development', EXPO_PUBLIC_APP_VARIANT: 'production' });

    expect(resolve(resolver, DEV_PANEL)).toBe(DEV_PANEL);
  });

  it('leaves every other module alone in production', () => {
    const resolver = resolverFor({ NODE_ENV: 'production', EXPO_PUBLIC_APP_VARIANT: 'production' });
    const other = path.join(repoRoot, 'src/ui/screens/HomeScreen.tsx');

    expect(resolve(resolver, other)).toBe(other);
  });

  it('swaps a module that actually exists — a renamed panel must fail loudly', () => {
    // The swap is keyed on an absolute path. Move or rename either file without
    // updating metro.config.js and the rule silently stops applying, which is
    // exactly the failure mode this whole test file exists for.
    expect(fs.existsSync(DEV_PANEL)).toBe(true);
    expect(fs.existsSync(DEV_PANEL_STUB)).toBe(true);
  });

  it('keeps the sample gallery confined to the module that gets swapped', () => {
    // If picsum URLs appear anywhere else in the app's source, the resolver
    // swap does not cover them and they ship. Test files are exempt: they are
    // never part of the bundle's dependency graph, and some use picsum as a
    // fixture URL.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && full !== DEV_PANEL) {
          if (fs.readFileSync(full, 'utf8').includes('picsum.photos')) offenders.push(full);
        }
      }
    };
    walk(path.join(repoRoot, 'src'));

    expect(offenders).toEqual([]);
  });
});
