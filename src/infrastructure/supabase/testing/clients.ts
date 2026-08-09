/**
 * TEST-ONLY client builders for the `*.integration.test.ts` suites. Nothing in
 * the app imports this file — production code shares the single client in
 * `../client`.
 *
 * Integration tests need clients the app never builds: a service-role client to
 * seed rows the way an Edge Function does, a bare anon client to prove RLS
 * blocks it, and a signed-in client whose `auth.uid()` the owner-only policies
 * from migration 20240031 will match.
 */
import { createClient } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../types';

/**
 * Supabase's auth storage is `localStorage` by default, which Node lacks, and
 * AsyncStorage needs React Native. An in-memory map is enough for a test run —
 * and keeps two clients in the same file from sharing a session.
 */
function inMemoryStorage(): {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
  removeItem: (k: string) => Promise<void>;
} {
  const store = new Map<string, string>();
  return {
    getItem: (k): Promise<string | null> => Promise.resolve(store.get(k) ?? null),
    setItem: (k, v): Promise<void> => { store.set(k, v); return Promise.resolve(); },
    removeItem: (k): Promise<void> => { store.delete(k); return Promise.resolve(); },
  };
}

// `createClient` resolves its schema generics differently depending on the
// options passed, so a client built here is structurally the app's client but
// not nominally assignable to `AppSupabaseClient`. The casts are that gap, and
// nothing more — the runtime object is the same class either way.

/** Bypasses RLS — the path every Edge Function takes. Use it to seed and clean. */
export function serviceRoleClient(url: string, serviceKey: string): AppSupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } }) as AppSupabaseClient;
}

/** The `anon` role with no session: what an attacker holding the bundled key has. */
export function anonClient(url: string, anonKey: string): AppSupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: false } }) as AppSupabaseClient;
}

/**
 * A client signed in as the Supabase "test phone number" — the app's own state
 * after OTP verification, so its queries run as `authenticated` with a real
 * `auth.uid()`. Returns that uid, which is what the app stores as `publisher_id`
 * (see `usePublisherId`), so tests can seed rows the policies will match.
 *
 * Configure the number and its fixed OTP in Supabase → Auth → Phone, and pass
 * them as AUTH_TEST_PHONE / AUTH_TEST_OTP.
 */
export async function signedInClient(
  url: string,
  anonKey: string,
  phone: string,
  otp: string,
): Promise<{ client: AppSupabaseClient; userId: string }> {
  const client = createClient(url, anonKey, {
    auth: {
      storage: inMemoryStorage(),
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  // The OTP for a test number is fixed, so verify directly — requesting a fresh
  // one here would hit Supabase's per-number rate limit.
  const { data, error } = await client.auth.verifyOtp({ phone, token: otp, type: 'sms' });
  if (error != null) throw new Error(`test sign-in failed: ${error.message}`);
  const userId = data.user?.id;
  if (userId == null) throw new Error('test sign-in returned no user');
  return { client, userId };
}
