/**
 * Supabase Edge Function: POST /twilio-status
 *
 * Twilio StatusCallback receiver (issue #24). The sending functions pass this
 * function's URL as StatusCallback on every outbound WhatsApp message; Twilio
 * then POSTs form-encoded lifecycle events here (queued → sent → delivered,
 * or failed / undelivered + ErrorCode).
 *
 * Each event updates the message's `message_logs` row by MessageSid. When the
 * failure code says the RECIPIENT is unreachable (invalid / non-WhatsApp /
 * blocked number — see UNREACHABLE codes in _shared/messageLog.ts), the
 * subscriber row is marked `unreachable` so future batches skip the number and
 * the publisher sees it in the Followers list.
 *
 * Every request is verified against X-Twilio-Signature so the endpoint can't
 * be spoofed into corrupting delivery records.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
 *      TWILIO_AUTH_TOKEN,
 *      TWILIO_STATUS_CALLBACK_URL (optional — the public URL Twilio calls, if
 *      it differs from req.url behind a proxy; needed for signature match).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { formToParams, verifyTwilioSignature } from '../_shared/optOut.ts';
import { markSubscriberUnreachable } from '../_shared/messageLog.ts';
import { shouldMarkUnreachable } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const PUBLIC_URL = Deno.env.get('TWILIO_STATUS_CALLBACK_URL') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const params = formToParams(await req.formData());

  if (TWILIO_AUTH_TOKEN) {
    const ok = await verifyTwilioSignature({
      authToken: TWILIO_AUTH_TOKEN,
      url: PUBLIC_URL || req.url,
      params,
      signature: req.headers.get('X-Twilio-Signature'),
    });
    if (!ok) {
      console.warn('Rejected status callback with invalid Twilio signature');
      return new Response('Invalid signature', { status: 403 });
    }
  } else {
    console.warn('TWILIO_AUTH_TOKEN not set — skipping signature verification');
  }

  const sid = params['MessageSid'] ?? '';
  const status = params['MessageStatus'] ?? '';
  const errorCode = params['ErrorCode'] ?? '';
  if (!sid || !status) return new Response('MessageSid and MessageStatus required', { status: 400 });

  const { data: updated, error } = await supabase
    .from('message_logs')
    .update({
      status,
      error_code: errorCode || null,
      updated_at: new Date().toISOString(),
    })
    .eq('message_sid', sid)
    .select('publisher_id, contact_handle')
    .maybeSingle();
  if (error) {
    console.error(`message_logs update for ${sid} failed:`, error.message);
    return new Response('', { status: 500 });
  }
  // Unknown SID (e.g. a message sent before logging existed) — nothing to do.
  if (updated == null) return new Response('', { status: 204 });

  if (shouldMarkUnreachable(status, errorCode)) {
    await markSubscriberUnreachable(supabase, updated.publisher_id, updated.contact_handle);
  }

  return new Response('', { status: 204 });
});
