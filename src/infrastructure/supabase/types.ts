import type { supabase } from './client';

/**
 * The type of the app's shared Supabase client — what repositories accept by
 * injection (issue #115).
 *
 * Taken from the real client rather than written out as `SupabaseClient`: the
 * bare type's generic defaults are not what `createClient` actually infers, so
 * passing a live client to a `SupabaseClient` parameter trips
 * `no-unsafe-argument`. Deriving it here keeps the two in step across
 * supabase-js versions.
 *
 * `import type` is erased at compile time, so naming the type does NOT import
 * `./client` at runtime — repositories stay free of the module that constructs
 * the client (and of the AsyncStorage import behind it, which no unit test
 * could load).
 */
export type AppSupabaseClient = typeof supabase;
