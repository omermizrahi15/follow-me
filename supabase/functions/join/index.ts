/**
 * Supabase Edge Function: GET /join/:publisherId
 *
 * Renders a landing page with a WhatsApp deep-link button.
 * The subscriber taps the button, WhatsApp opens with a pre-filled
 * "JOIN {publisherId}" message addressed to the Twilio number.
 * When they send it, the join-webhook function handles the subscription.
 *
 * Environment variables expected:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (injected by Supabase automatically)
 *   TWILIO_WHATSAPP_FROM  (E.164 format, e.g. +14155238886)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Returns true only if the publisher id maps to a real user. Wrapped in
// try/catch because getUserById throws on a malformed (non-UUID) id, which
// would otherwise surface as a 500.
async function publisherExists(publisherId: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    return data.user != null;
  } catch {
    return false;
  }
}

// wa.me expects the number without the leading '+'
function waLink(publisherId: string): string {
  const number = TWILIO_FROM.replace(/^\+/, '');
  const text = encodeURIComponent(`JOIN ${publisherId}`);
  return `https://wa.me/${number}?text=${text}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  // Path: /join/<publisherId> — the last segment. (When no id is supplied the
  // last segment is the function name "join", which we reject.)
  const publisherId = url.pathname.split('/').filter(Boolean).at(-1) ?? '';

  if (!publisherId || publisherId === 'join') {
    return new Response('This invite link is invalid.', { status: 400 });
  }

  if (!(await publisherExists(publisherId))) {
    return new Response('This invite link is invalid or has expired.', { status: 404 });
  }

  // Supabase Edge Functions force responses to text/plain (they won't serve
  // rendered HTML), so instead of a landing page we redirect straight to
  // WhatsApp with the JOIN message pre-filled — one tap, then the follower
  // just hits send.
  return new Response(null, {
    status: 302,
    headers: { Location: waLink(publisherId) },
  });
});
