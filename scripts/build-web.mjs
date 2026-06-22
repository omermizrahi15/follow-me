// Bundles the join page (web/main.ts -> web/join.js) with esbuild.
// Supabase config is injected at build time from the EXPO_PUBLIC_* env vars
// (the anon key is already public — it ships in the mobile app too).
import { build } from 'esbuild';
import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set them in .env before building the web join page.',
  );
  process.exit(1);
}

await build({
  entryPoints: ['web/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  outfile: 'web/join.js',
  define: {
    __SUPABASE_URL__: JSON.stringify(url),
    __SUPABASE_ANON_KEY__: JSON.stringify(anonKey),
  },
  logLevel: 'info',
});

console.log('Built web/join.js');
