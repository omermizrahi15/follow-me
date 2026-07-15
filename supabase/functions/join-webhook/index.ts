/**
 * Supabase Edge Function: POST /join-webhook
 *
 * Twilio webhook for ALL incoming WhatsApp messages on our number. Twilio
 * delivers every inbound reply here, so this one endpoint handles:
 *   - JOIN {publisherId} — the subscribe handshake from the join page
 *   - STOP / UNSUBSCRIBE  — opt out, revokes the subscription(s) (issue #15)
 *   - START               — opt back in, re-activates a revoked subscription
 *
 * Every request is verified against Twilio's X-Twilio-Signature so the endpoint
 * can't be spoofed, and every opt-out/opt-in is written to notification_log for
 * compliance auditing.
 *
 * Environment variables expected:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (injected by Supabase automatically)
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 *   TWILIO_WEBHOOK_URL  (optional — the public URL Twilio calls, if it differs
 *                        from req.url behind a proxy; needed for signature match)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  parseInboundCommand,
  composeUnsubscribeConfirmation,
  composeResubscribeConfirmation,
  formToParams,
  verifyTwilioSignature,
} from '../_shared/optOut.ts';
import { publisherDisplayName } from '../_shared/publisher.ts';
import { contactHandleFromWhatsApp, twiml } from './logic.ts';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const TWILIO_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '';
const TWILIO_WEBHOOK_URL = Deno.env.get('TWILIO_WEBHOOK_URL') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

async function lookupPublisher(publisherId: string): Promise<{ name: string } | null> {
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    if (!data.user) return null;
    return { name: publisherDisplayName(data.user.user_metadata as Record<string, string>, data.user.email) };
  } catch {
    return null;
  }
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

interface SubscriberRow {
  id: string;
  publisher_id: string;
  status: string;
}

// Audit write — never let a logging failure break the user-facing flow.
async function logEvent(
  event: 'opt_out' | 'opt_in',
  row: { subscriberId: string | null; publisherId: string; contactHandle: string; detail: string },
): Promise<void> {
  const { error } = await supabase.from('notification_log').insert({
    subscriber_id: row.subscriberId,
    publisher_id: row.publisherId,
    contact_handle: row.contactHandle,
    event,
    detail: row.detail,
  });
  if (error) console.error('notification_log insert failed:', error.message);
}

// Resolve a display name for the confirmation reply from a set of rows. With a
// single publisher (the common case) we name it; otherwise stay generic.
async function publisherNameFor(rows: SubscriberRow[]): Promise<string> {
  const ids = [...new Set(rows.map(r => r.publisher_id))];
  if (ids.length === 1) {
    const publisher = await lookupPublisher(ids[0] as string);
    if (publisher) return publisher.name;
  }
  return 'your publisher';
}

async function handleStop(contactHandle: string, from: string, detail: string): Promise<Response> {
  const { data: rows } = await supabase
    .from('subscribers')
    .select('id, publisher_id, status')
    .eq('contact_handle', contactHandle);
  const subscribers = (rows ?? []) as SubscriberRow[];

  // Unknown number — stay silent (don't confirm an unsubscribe we never had).
  if (subscribers.length === 0) return new Response('', { status: 204 });

  // An explicit STOP beats 'unreachable' — record the opt-out either way.
  for (const sub of subscribers.filter(s => s.status === 'active' || s.status === 'unreachable')) {
    await supabase.from('subscribers').update({ status: 'revoked' }).eq('id', sub.id);
    await logEvent('opt_out', {
      subscriberId: sub.id,
      publisherId: sub.publisher_id,
      contactHandle,
      detail,
    });
  }

  const name = await publisherNameFor(subscribers);
  const message = composeUnsubscribeConfirmation(name);
  try {
    await sendWhatsApp(from, message);
    return new Response('', { status: 204 });
  } catch (err) {
    console.error('STOP confirmation failed, falling back to TwiML:', err);
    return twiml(message);
  }
}

async function handleStart(contactHandle: string, from: string, detail: string): Promise<Response> {
  const { data: rows } = await supabase
    .from('subscribers')
    .select('id, publisher_id, status')
    .eq('contact_handle', contactHandle);
  const subscribers = (rows ?? []) as SubscriberRow[];

  if (subscribers.length === 0) return new Response('', { status: 204 });

  // A START from the number proves it's reachable again, so 'unreachable'
  // rows reactivate here too.
  for (const sub of subscribers.filter(s => s.status === 'revoked' || s.status === 'unreachable')) {
    await supabase.from('subscribers').update({ status: 'active' }).eq('id', sub.id);
    await logEvent('opt_in', {
      subscriberId: sub.id,
      publisherId: sub.publisher_id,
      contactHandle,
      detail,
    });
  }

  const name = await publisherNameFor(subscribers);
  const message = composeResubscribeConfirmation(name);
  try {
    await sendWhatsApp(from, message);
    return new Response('', { status: 204 });
  } catch (err) {
    console.error('START confirmation failed, falling back to TwiML:', err);
    return twiml(message);
  }
}

async function handleJoin(
  publisherId: string,
  contactHandle: string,
  from: string,
): Promise<Response> {
  const publisher = await lookupPublisher(publisherId);
  if (!publisher) {
    return twiml('Sorry, that join link is no longer valid.');
  }

  const { error } = await supabase.from('subscribers').upsert(
    { publisher_id: publisherId, contact_handle: contactHandle, status: 'active' },
    { onConflict: 'publisher_id,contact_handle' },
  );
  if (error) {
    console.error('DB upsert failed:', error.message);
    return twiml('Something went wrong. Please try again later.');
  }

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
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const params = formToParams(await req.formData());

  // Verify the request really came from Twilio before acting on it. Skipped
  // only when no auth token is configured (local dev), with a loud warning.
  if (TWILIO_AUTH_TOKEN) {
    const url = TWILIO_WEBHOOK_URL || req.url;
    const ok = await verifyTwilioSignature({
      authToken: TWILIO_AUTH_TOKEN,
      url,
      params,
      signature: req.headers.get('X-Twilio-Signature'),
    });
    if (!ok) {
      console.warn('Rejected request with invalid Twilio signature');
      return new Response('Invalid signature', { status: 403 });
    }
  } else {
    console.warn('TWILIO_AUTH_TOKEN not set — skipping signature verification');
  }

  // Twilio sends From as "whatsapp:+15551234567"
  const from = params['From'] ?? '';
  const body = params['Body'] ?? '';
  const contactHandle = contactHandleFromWhatsApp(from);

  const command = parseInboundCommand(body);
  switch (command.kind) {
    case 'stop':
      return handleStop(contactHandle, from, body.trim());
    case 'start':
      return handleStart(contactHandle, from, body.trim());
    case 'join':
      return handleJoin(command.publisherId, contactHandle, from);
    default:
      // Unknown message — acknowledge with no reply.
      return new Response('', { status: 204 });
  }
});
