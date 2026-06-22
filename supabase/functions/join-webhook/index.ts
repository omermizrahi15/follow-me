/**
 * Supabase Edge Function: POST /join-webhook
 *
 * Twilio webhook for incoming WhatsApp messages.
 * When a subscriber taps "Subscribe on WhatsApp" from the join page,
 * their WhatsApp opens with "JOIN {publisherId}" pre-filled. When they send it,
 * Twilio calls this endpoint with their number (From) and the message (Body).
 *
 * Environment variables expected:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (injected by Supabase automatically)
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const TWILIO_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// TwiML response — Twilio requires this content-type for webhook replies
function twiml(message: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${message}</Message></Response>`,
    { headers: { 'content-type': 'text/xml' } },
  );
}

async function lookupPublisher(publisherId: string): Promise<{ name: string } | null> {
  const { data } = await supabase.auth.admin.getUserById(publisherId);
  if (!data.user) return null;
  const name: string =
    (data.user.user_metadata as Record<string, string>)?.display_name ??
    data.user.email?.split('@')[0] ??
    'your publisher';
  return { name };
}

async function sendWhatsApp(to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({
    From: `whatsapp:${TWILIO_FROM}`,
    To: to,
    Body: body,
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Twilio error (${resp.status}): ${text}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const form = await req.formData();
  // Twilio sends From as "whatsapp:+15551234567"
  const from = (form.get('From') as string | null) ?? '';
  const body = ((form.get('Body') as string | null) ?? '').trim();

  // Extract E.164 number from "whatsapp:+15551234567"
  const contactHandle = from.replace(/^whatsapp:/, '');

  // Only handle JOIN messages — ignore everything else silently
  const joinMatch = /^JOIN\s+(\S+)$/i.exec(body);
  if (!joinMatch) {
    return new Response('', { status: 204 });
  }

  const publisherId = joinMatch[1] ?? '';

  const publisher = await lookupPublisher(publisherId);
  if (!publisher) {
    return twiml("Sorry, that join link is no longer valid.");
  }

  const { error } = await supabase.from('subscribers').upsert(
    { publisher_id: publisherId, contact_handle: contactHandle, status: 'active' },
    { onConflict: 'publisher_id,contact_handle' },
  );

  if (error) {
    console.error('DB upsert failed:', error.message);
    return twiml("Something went wrong. Please try again later.");
  }

  // Send a proper confirmation via the Messaging API (richer than TwiML for async flows)
  // Fall back to TwiML reply if the API call fails
  try {
    await sendWhatsApp(
      from,
      `You're now following ${publisher.name}. You'll receive their photos here on WhatsApp. Reply STOP at any time to unsubscribe.`,
    );
    return new Response('', { status: 204 });
  } catch (err) {
    console.error('WhatsApp confirmation failed, falling back to TwiML:', err);
    return twiml(`You're now following ${publisher.name}. Reply STOP at any time to unsubscribe.`);
  }
});
