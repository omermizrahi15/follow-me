/**
 * Guards the arrangement that lets one implementation serve two runtimes.
 *
 * A handful of modules under src/ are imported verbatim by the Deno Edge
 * Functions (see CONTRIBUTING.md). Deno resolves relative specifiers as URLs,
 * so it cannot follow the extensionless imports the rest of the app is written
 * in — which means a dual-runtime module must not import anything at all. Add
 * one `import type { Foo } from '../entities/Foo'` to `photoSelection.ts` and
 * every Edge Function stops resolving.
 *
 * `deno check` catches that, but only in the services CI job. This test makes
 * it fail in `npm test`, next to the code being edited.
 */
import fs from 'fs';
import path from 'path';

const repoRoot = path.join(__dirname, '..');
const functionsDir = path.join(repoRoot, 'supabase/functions');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

const functionFiles = walk(functionsDir);

/** Every src/ module an Edge Function reaches for, as repo-relative paths. */
function dualRuntimeModules(): string[] {
  const found = new Set<string>();
  for (const file of functionFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+'((?:\.\.\/)+src\/[^']+\.ts)'/g)) {
      const specifier = match[1];
      if (specifier == null) continue;
      found.add(path.relative(repoRoot, path.resolve(path.dirname(file), specifier)));
    }
  }
  return [...found].sort();
}

/** Import/require statements, ignoring anything inside a comment. */
function importLines(source: string): string[] {
  return source
    .split('\n')
    .map(line => line.trim())
    .filter(line => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
    .filter(line => /^import[\s{'"*]/.test(line) || /^export\s.*\sfrom\s/.test(line) || /\brequire\(/.test(line));
}

describe('dual-runtime modules', () => {
  const modules = dualRuntimeModules();

  it('are actually being shared — the Edge Functions import src/ directly', () => {
    // If this drops to zero, someone has re-forked the logic into
    // supabase/functions and the rest of these guards are inert.
    expect(modules.length).toBeGreaterThan(0);
  });

  it.each(dualRuntimeModules())('%s exists', (relative: string) => {
    expect(fs.existsSync(path.join(repoRoot, relative))).toBe(true);
  });

  it.each(dualRuntimeModules())('%s imports nothing (Deno cannot resolve app-style specifiers)', (relative: string) => {
    const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    expect(importLines(source)).toEqual([]);
  });
});

describe('supabase/functions', () => {
  it('carries no hand-maintained mirror of app logic', () => {
    // Issue #117: six modules were duplicated here and kept in step by comment.
    // A "KEEP IN SYNC" marker means one has come back.
    const offenders = functionFiles
      .filter(file => /KEEP IN SYNC|Deno mirror|Deno port/i.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });
});
