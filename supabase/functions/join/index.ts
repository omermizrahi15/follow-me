/**
 * Supabase Edge Function: GET /join/:publisherId
 *
 * Redirects to a WhatsApp deep-link that pre-fills "JOIN {publisherId}" to the
 * Twilio number. When the follower sends it, the join-webhook function handles
 * the subscription. Request logic lives in ./logic.ts (unit-tested); this file
 * only wires the real Supabase client + env in.
 *
 * Environment variables expected:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (injected by Supabase automatically)
 *   TWILIO_WHATSAPP_FROM  (E.164 format, e.g. +14155238886)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleJoin } from './logic.ts';

const TWILIO_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Wrapped in try/catch because getUserById throws on a malformed (non-UUID) id,
// which would otherwise surface as a 500.
async function publisherExists(publisherId: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    return data.user != null;
  } catch {
    return false;
  }
}

Deno.serve((req: Request) => handleJoin(req, { twilioFrom: TWILIO_FROM, publisherExists }));
