/**
 * Supabase Edge Function: POST /subscribe
 * Body: { "publisherId": "<uuid>", "contactHandle": "<whatsapp number>" }
 *
 * Called by the static join page (GitHub Pages). Validates the publisher and
 * the WhatsApp number, then inserts/reactivates the subscriber using the
 * SERVICE-ROLE key — so it bypasses RLS and the number is never exposed to the
 * anon role.
 *
 * After a successful subscribe it sends a WhatsApp welcome via Twilio. Followers
 * arrive here by typing their number on the join page, so they have never
 * messaged our number and WhatsApp's 24-hour free-form window is closed: on a
 * production sender the welcome only goes through as an approved template
 * (`TWILIO_TEMPLATE_WELCOME_SID`, issue #164) — without it Twilio rejects the
 * send with 63016. Free-form remains the fallback for the sandbox, where the
 * "join <code>" opt-in does open a window.
 *
 * Either way the send is BEST-EFFORT: a failure is logged but the subscribe is
 * still reported as successful, since the DB row is what actually matters.
 *
 * Env (injected automatically by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Env (Twilio): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM,
 *   TWILIO_TEMPLATE_WELCOME_SID
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { composeWelcomeMessage } from '../../../src/domain/services/optOutMessages.ts';
import {
  credsFromEnv,
  sendWhatsApp,
  sendWhatsAppTemplate,
} from '../../../src/infrastructure/notifiers/twilioClient.ts';
import { logAcceptedSend } from '../_shared/messageLog.ts';
import { publisherDisplayName } from '../_shared/publisher.ts';
import { buildWelcomeTemplate } from '../_shared/welcomeTemplate.ts';
import { normalizeWhatsApp } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TWILIO = credsFromEnv(Deno.env);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Resolve the publisher's display name for the confirmation copy.
async function lookupPublisherName(publisherId: string): Promise<string> {
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    if (!data.user) return 'your publisher';
    return publisherDisplayName(data.user.user_metadata as Record<string, string>, data.user.email);
  } catch {
    return 'your publisher';
  }
}

// Best-effort WhatsApp send; never throws (the caller must not fail on it).
// Prefers the approved template — the only thing that reaches a follower who
// has never messaged us — and falls back to free-form when no SID is set.
// Uses the shared sender, so transient Twilio errors are retried with backoff
// and the accepted message lands in message_logs for delivery tracking.
async function sendWelcome(publisherId: string, contactHandle: string, publisherName: string): Promise<void> {
  if (!TWILIO.accountSid || !TWILIO.fromNumber) {
    console.warn('Twilio not configured — skipping subscribe confirmation');
    return;
  }
  const template = buildWelcomeTemplate({ welcomeSid: TWILIO.templateWelcomeSid }, { publisherName });
  try {
    const { sid } = template != null
      ? await sendWhatsAppTemplate(TWILIO, contactHandle, template.contentSid, template.variables)
      : await sendWhatsApp(TWILIO, contactHandle, composeWelcomeMessage(publisherName));
    if (sid != null) await logAcceptedSend(supabase, { sid, publisherId, contactHandle });
  } catch (err) {
    console.error('Subscribe confirmation send failed:', err);
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
  await sendWelcome(publisherId, contactHandle, publisherName);

  return json({ ok: true });
});
