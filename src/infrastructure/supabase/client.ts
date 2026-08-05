import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from '../env';

// Static `process.env.EXPO_PUBLIC_*` references so Expo inlines the values into
// the production bundle; a dynamic/bracket lookup stays undefined at runtime.
export const supabaseUrl = requireEnv(
  process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined,
  'EXPO_PUBLIC_SUPABASE_URL',
);
export const supabaseAnonKey = requireEnv(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined,
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
);

/**
 * The app's one and only Supabase client (issue #115).
 *
 * Every repository is handed *this* instance rather than building its own, and
 * that is a security requirement, not a tidiness one: the session lives here,
 * so every query carries the signed-in user's JWT and runs as the
 * `authenticated` role. The RLS policies added in migration 20240031 are scoped
 * to `auth.uid()`, so a repository holding a separate `persistSession: false`
 * client would run as `anon` and read nothing at all.
 *
 * `storage: AsyncStorage` is what makes the session survive a cold start —
 * supabase-js defaults to `localStorage`, which does not exist in React Native.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
