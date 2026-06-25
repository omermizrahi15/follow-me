/**
 * Supabase Edge Function: POST /subscribe
 * Body: { "publisherId": "<uuid>", "contactHandle": "<whatsapp number>" }
 *
 * Called by the static join page (GitHub Pages). Validates the publisher and
 * the WhatsApp number, then inserts/reactivates the subscriber using the
 * SERVICE-ROLE key — so it bypasses RLS and the number is never exposed to the
 * anon role.
 *
 * After a successful subscribe it sends a WhatsApp confirmation via Twilio.
 * This is BEST-EFFORT: WhatsApp only delivers free-form messages inside the
 * 24-hour window after the user last messaged our number (in the Twilio sandbox,
 * after they've sent the "join <code>" opt-in). If that window is closed the
 * send fails — we log it but still report the subscribe as successful, since the
 * DB row is what actually matters.
 *
 * Env (injected automatically by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Env (Twilio): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const TWILIO_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Resolve the publisher's display name for the confirmation copy.
async function lookupPublisherName(publisherId: string): Promise<string> {
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    if (!data.user) return 'your publisher';
    // `||` (not `??`) so an empty display_name falls through to a real fallback.
    return (
      (data.user.user_metadata as Record<string, string>)?.display_name ||
      data.user.email?.split('@')[0] ||
      'your publisher'
    );
  } catch {
    return 'your publisher';
  }
}

// Best-effort WhatsApp send; never throws (the caller must not fail on it).
async function sendWelcome(contactHandle: string, publisherName: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
    console.warn('Twilio not configured — skipping subscribe confirmation');
    return;
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({
    From: `whatsapp:${TWILIO_FROM}`,
    To: `whatsapp:${contactHandle}`,
    Body: `You're now following ${publisherName}. You'll receive their photos here on WhatsApp. Reply STOP at any time to unsubscribe.`,
  });
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!resp.ok) {
      console.error(`Subscribe confirmation failed (${resp.status}):`, await resp.text());
    }
  } catch (err) {
    console.error('Subscribe confirmation send threw:', err);
  }
}

// The page is served from a different origin (GitHub Pages), so allow CORS.
const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Validate + normalize to E.164 (e.g. "+972501234567"); null when implausible.
function normalizeWhatsApp(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s()-]/g, '');
  if (!/^\+?[1-9]\d{7,14}$/.test(cleaned)) return null;
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

// try/catch because getUserById throws on a malformed (non-UUID) id.
async function publisherExists(publisherId: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    return data.user != null;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let payload: { publisherId?: string; contactHandle?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  const publisherId = (payload.publisherId ?? '').trim();
  const contactHandle = normalizeWhatsApp(payload.contactHandle ?? '');

  if (!publisherId) {
    return json({ ok: false, error: 'This invite link is invalid.' }, 400);
  }
  if (!contactHandle) {
    return json(
      { ok: false, error: 'Enter a valid WhatsApp number, including country code (e.g. +972501234567).' },
      400,
    );
  }
  if (!(await publisherExists(publisherId))) {
    return json({ ok: false, error: 'This invite link is invalid or has expired.' }, 404);
  }

  // Insert or reactivate, idempotently. Done as select-then-write (rather than
  // upsert) so it doesn't depend on a unique constraint or an id default.
  const { data: existing, error: selErr } = await supabase
    .from('subscribers')
    .select('id')
    .eq('publisher_id', publisherId)
    .eq('contact_handle', contactHandle)
    .maybeSingle();
  if (selErr) return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500);

  const write = existing
    ? supabase.from('subscribers').update({ status: 'active' }).eq('id', existing.id)
    : supabase.from('subscribers').insert({
        id: crypto.randomUUID(),
        publisher_id: publisherId,
        contact_handle: contactHandle,
        status: 'active',
      });

  const { error } = await write;
  if (error) return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500);

  const publisherName = await lookupPublisherName(publisherId);
  await sendWelcome(contactHandle, publisherName);

  return json({ ok: true });
});
