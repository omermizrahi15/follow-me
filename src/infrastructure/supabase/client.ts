import { createClient } from '@supabase/supabase-js';

// Static `process.env.EXPO_PUBLIC_*` references so Expo inlines the values into
// the production bundle; a dynamic/bracket lookup stays undefined at runtime.
const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined) ?? '';
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined) ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
