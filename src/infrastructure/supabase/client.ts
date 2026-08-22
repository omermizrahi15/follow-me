import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { env } from '../env';
import { appFetch } from '../http/appFetch';

// Read through ../env rather than checked here: this module loads before
// anything else, so a throw at this line is the whole app failing on one
// variable, which is what issue #110 set out to stop. Missing configuration
// yields placeholders and `envSetupMessage`, and the UI shows the full list
// instead of mounting a navigator that would query with them.
export const supabaseUrl = env.supabaseUrl;
export const supabaseAnonKey = env.supabaseAnonKey;

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
  // Every request the SDK makes — tables, auth, storage, the ones no repository
  // can reach — inherits a deadline and, for reads, a retry (issue #145).
  // Without it a query on a dead connection never settles, and the screen that
  // awaited it shows a spinner for as long as the app is open.
  global: { fetch: appFetch },
});
