/**
 * Guards the machinery behind `import/no-restricted-paths`, not the rule itself.
 *
 * The zones in `.eslintrc.js` were correct for months while enforcing nothing:
 * the `import` plugin ran with only `eslint-import-resolver-node`, which cannot
 * resolve `.ts`/`.tsx`. Every restricted import failed to resolve, and an
 * unresolved import is not a violation — so lint stayed green over 16 real
 * breaches (#107). Nothing about that failure is visible in lint output, which
 * is why it survived; these assertions make it loud instead.
 *
 * Running ESLint itself here would be the direct test, but type-aware linting
 * costs ~20s for a single file — more than the whole unit suite. `npm run lint`
 * already covers that, in pre-commit and in CI.
 */
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
const eslintrc = require('../.eslintrc.js') as {
  settings?: { 'import/resolver'?: Record<string, unknown> };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const tsResolver = require('eslint-import-resolver-typescript') as {
  resolve: (
    source: string,
    file: string,
    config: unknown,
  ) => { found: boolean; path?: string | null };
};

const repoRoot = path.join(__dirname, '..');

describe('architecture layer boundaries', () => {
  it('wires a TypeScript-aware resolver for the import plugin', () => {
    expect(eslintrc.settings?.['import/resolver']).toHaveProperty('typescript');
  });

  it('resolves a cross-layer .ts import, so the restricted-path zones can fire', () => {
    // A synthetic pair: the import below is exactly the kind of breach the zones
    // forbid, and no file writes it today. What matters is that the resolver
    // *finds* the target — an import it cannot resolve is one the rule ignores.
    const result = tsResolver.resolve(
      '../../infrastructure/cache/SuggestionCache',
      path.join(repoRoot, 'src/ui/screens/ReviewSuggestionScreen.tsx'),
      { project: './tsconfig.json' },
    );

    expect(result.found).toBe(true);
    expect(result.path).toBe(
      path.join(repoRoot, 'src/infrastructure/cache/SuggestionCache.ts'),
    );
  });
});
