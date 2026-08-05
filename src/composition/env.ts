/**
 * Build-time configuration, read in one place so a fresh clone learns
 * everything it is missing at once.
 *
 * The app needs accounts at three services before it can render anything, and
 * discovering that one variable at a time — throw, read the message, sign up,
 * rebuild, throw again — is the slowest possible way to find out (issue #110).
 * So nothing here throws: the missing names are collected, the wiring in
 * container.ts continues against inert placeholders, and the UI renders the
 * setup message instead of the navigator. Nothing reaches the network in that
 * state, because no screen that talks to a use case is ever mounted.
 *
 * Every read below MUST be a static `process.env.EXPO_PUBLIC_X` reference:
 * Expo inlines only static references into the production bundle, so a dynamic
 * `process.env[name]` lookup is `undefined` at runtime and would report a
 * correctly-configured app as unconfigured.
 */

/** One required build-time variable, and where a new contributor obtains it. */
export interface EnvVar {
  /** The name as it appears in `.env`. */
  readonly name: string;
  /** Where to get the value — named so the reader knows which tab to open. */
  readonly source: string;
  readonly value: string | undefined;
}

/** Every required variable that has no usable value. */
export function missingVars(vars: readonly EnvVar[]): EnvVar[] {
  // Blank counts as missing: a `KEY=` line left in .env would otherwise sail
  // past the check and fail much later, inside an HTTP request.
  return vars.filter(v => (v.value ?? '').trim() === '');
}

/** The whole "here is what to do about it" message, shown on screen and logged. */
export function setupMessage(missing: readonly EnvVar[]): string {
  const count =
    missing.length === 1
      ? '1 required variable is missing'
      : `${missing.length} required variables are missing`;
  const list = missing.map(v => `  ${v.name}\n    ↳ ${v.source}`).join('\n');

  return (
    `Follow Me is not configured yet — ${count} from your .env:\n\n` +
    `${list}\n\n` +
    'Copy .env.example to .env and fill these in, then restart Metro with ' +
    '`npx expo start -c` — env values are baked in at bundle time, so a plain ' +
    'reload keeps the old ones.\n\n' +
    'Full walkthrough (including a local Supabase that needs no accounts at ' +
    'all): README.md → "Getting started"\n' +
    'https://github.com/omermizrahi15/follow-me#getting-started'
  );
}

const REQUIRED: readonly EnvVar[] = [
  {
    name: 'EXPO_PUBLIC_SUPABASE_URL',
    source: 'Supabase → Project Settings → Data API, or `supabase start` for a local one',
    value: process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined,
  },
  {
    name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    source: 'Supabase → Project Settings → API Keys → anon/public',
    value: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined,
  },
  {
    name: 'EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME',
    source: 'Cloudinary → Dashboard (top left, under your account name)',
    value: process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME as string | undefined,
  },
  {
    name: 'EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET',
    source: 'Cloudinary → Settings → Upload → add an UNSIGNED upload preset',
    value: process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET as string | undefined,
  },
  {
    name: 'EXPO_PUBLIC_CLASSIFY_FN_URL',
    source:
      'endpoint of the deployed classify-photos Edge Function, or ' +
      'http://127.0.0.1:54321/functions/v1/classify-photos when serving locally',
    value: process.env.EXPO_PUBLIC_CLASSIFY_FN_URL as string | undefined,
  },
];

/**
 * Stand-ins used only while configuration is missing, so module-level wiring
 * (`createClient` rejects an empty URL) completes and the setup screen gets a
 * chance to render. `.invalid` is reserved by RFC 2606 and never resolves, so
 * a stray request fails locally rather than reaching someone else's host.
 */
const PLACEHOLDER_URL = 'https://setup-required.invalid';
const PLACEHOLDER_VALUE = 'setup-required';

const missing = missingVars(REQUIRED);

/** Non-null when the app cannot run — the exact text to put in front of the user. */
export const envSetupMessage: string | null =
  missing.length === 0 ? null : setupMessage(missing);

// The screen is the only place this shows on a device, but the developer who
// just ran `expo start` is looking at the terminal. Dev only, so the unit
// suite (which runs with no .env by design) stays quiet.
if (__DEV__ && envSetupMessage != null) console.warn(envSetupMessage);

/** Required values, ready to wire. Placeholders while `envSetupMessage` is set. */
export const env = {
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined) ?? PLACEHOLDER_URL,
  supabaseAnonKey:
    (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined) ?? PLACEHOLDER_VALUE,
  cloudinaryCloudName:
    (process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME as string | undefined) ?? PLACEHOLDER_VALUE,
  cloudinaryUploadPreset:
    (process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET as string | undefined) ?? PLACEHOLDER_VALUE,
  /** Optional — isolates staging uploads from production assets. */
  cloudinaryFolder: process.env.EXPO_PUBLIC_CLOUDINARY_FOLDER as string | undefined,
  classifyFnUrl:
    (process.env.EXPO_PUBLIC_CLASSIFY_FN_URL as string | undefined) ??
    `${PLACEHOLDER_URL}/classify-photos`,
  /** Optional — unset falls back to MapLibre's free demo tiles (issue #78). */
  maptilerKey: (process.env.EXPO_PUBLIC_MAPTILER_KEY as string | undefined) ?? '',
} as const;
