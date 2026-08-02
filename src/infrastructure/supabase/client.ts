import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from '../env';
import type { Database } from './database';

/**
 * Builds a Supabase client the way this app needs one: the session is persisted
 * in AsyncStorage and refreshed in the background, so every query made through
 * the returned client carries the signed-in user's JWT.
 *
 * The app's only `createClient` call (issue #115). Production uses the shared
 * instance below; integration tests call this directly to aim a client at a
 * different key (service role).
 */
export function createSupabaseClient(url: string, key: string): SupabaseClient<Database> {
  return createClient<Database>(url, key, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // React Native has no URL to read a session out of.
      detectSessionInUrl: false,
    },
  });
}

let instance: SupabaseClient<Database> | null = null;

function shared(): SupabaseClient<Database> {
  instance ??= createSupabaseClient(
    requireEnv(process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined, 'EXPO_PUBLIC_SUPABASE_URL'),
    requireEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined, 'EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  );
  return instance;
}

/**
 * The client every part of the app shares — auth and all eight repositories.
 * Sharing it is what makes queries authenticated: the session lives on the same
 * client that signed in, so supabase-js sends the user's JWT instead of falling
 * back to the anon key. Each repository used to build its own
 * `persistSession: false` client, which is why every read and write ran as the
 * `anon` role and RLS cannot be scoped to `auth.uid()` yet (issue #9).
 *
 * It is built on first use rather than at import: a client sets up a fetch
 * wrapper, the auth state machine, realtime scaffolding and an AsyncStorage
 * session read, and the composition root is imported on every launch —
 * including a background launch woken by a silent sync push.
 */
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, property) {
    const value = Reflect.get(shared(), property) as unknown;
    // Methods are bound to the real client: `this` must be the instance, not
    // the proxy, or supabase-js reads its internals off an empty object.
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(shared())
      : value;
  },
});
