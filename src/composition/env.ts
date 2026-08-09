/**
 * The configuration check, re-exported for the UI (issue #110).
 *
 * The check itself lives in `infrastructure/env.ts`, because the shared
 * Supabase client needs it before anything else runs. The UI is not allowed to
 * import infrastructure directly, and going through the composition root is
 * exactly how it reaches every other capability — so this is that door, kept
 * to the one value a screen has any business reading.
 */
export { envSetupMessage } from '../infrastructure/env';
