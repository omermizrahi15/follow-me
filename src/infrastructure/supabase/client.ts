import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env['EXPO_PUBLIC_SUPABASE_URL'] as string | undefined) ?? '';
const supabaseAnonKey = (process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string | undefined) ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
