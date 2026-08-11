/**
 * Supabase Edge Function: POST /whatsapp-keepalive
 *
 * Meta locks a WhatsApp sender after a rolling 30-day period with no outbound
 * traffic. That lock is what silently broke delivery for a month: the sender
 * was registered in June, sent nothing while the integration was still being
 * built, and Meta disabled the WABA in mid-July (errors 63051 → 63112, and
 * inbound messages stopped arriving too). Recovering it took a support appeal.
 * A monthly cron calls this so the number is never idle that long again.
 *
 * Sends ONE approved template message to KEEPALIVE_TO. Two deliberate
 * differences from send-post:
 *   - it never touches `subscribers`. send-post marks a contact unreachable on
 *     a permanent Twilio failure; a keepalive must never revoke a real
 *     subscription as a side effect of its own plumbing breaking.
 *   - its message_logs rows carry a sentinel publisher_id, so they stay out of
 *     the per-publisher "who could not be reached" aggregation.
 *
 * The message body is whatever the approved post template renders — there is no
 * dedicated keepalive template, and free-form text is undeliverable outside the
 * 24h session window. It goes to the operator's own number, not a subscriber.
 *
 * Auth: x-cron-secret, same as auto-post.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected), CRON_SECRET,
 *      KEEPALIVE_TO (E.164 number to ping),
 *      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM,
 *      TWILIO_TEMPLATE_POST_SID (required — without it there is nothing
 *      deliverable outside the session window).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { credsFromEnv, sendWhatsAppTemplate, TwilioSendError } from '../_shared/twilio.ts';
import { buildPostTemplate } from '../_shared/postTemplate.ts';
import { logAcceptedSend, logRejectedSend } from '../_shared/messageLog.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const KEEPALIVE_TO = Deno.env.get('KEEPALIVE_TO') ?? '';
const TWILIO = credsFromEnv(Deno.env);

/** Keeps keepalive traffic out of per-publisher delivery stats. */
const KEEPALIVE_PUBLISHER_ID = 'keepalive';

/** Stable, public assets — the template needs a link and a header image. */
const KEEPALIVE_LINK = 'https://omermizrahi15.github.io/follow-me/join/';
const KEEPALIVE_IMAGE =
  'https://res.cloudinary.com/dixi8doyx/image/upload/v1786256372/branding/whatsapp-profile-logo.png';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (KEEPALIVE_TO === '') return json({ error: 'KEEPALIVE_TO is not configured' }, 500);

  const template = buildPostTemplate(
    { postSid: TWILIO.templatePostSid, postLocationSid: TWILIO.templatePostLocationSid },
    {
      publisherName: 'Follow-Me',
      publisherPhone: KEEPALIVE_TO,
      photoCount: 1,
      galleryUrl: KEEPALIVE_LINK,
      mediaUrl: KEEPALIVE_IMAGE,
    },
  );
  // No approved template configured — a free-form send would be rejected
  // outside the 24h window, so fail loudly rather than log a phantom success.
  if (template == null) return json({ error: 'No post template configured' }, 500);

  try {
    const { sid } = await sendWhatsAppTemplate(TWILIO, KEEPALIVE_TO, template.contentSid, template.variables);
    if (sid != null) {
      await logAcceptedSend(supabase, {
        sid,
        publisherId: KEEPALIVE_PUBLISHER_ID,
        contactHandle: KEEPALIVE_TO,
      });
    }
    return json({ sent: 1, sid });
  } catch (err) {
    console.error('whatsapp-keepalive send failed:', err);
    if (err instanceof TwilioSendError) {
      await logRejectedSend(supabase, {
        publisherId: KEEPALIVE_PUBLISHER_ID,
        contactHandle: KEEPALIVE_TO,
        error: err,
      });
    }
    return json({ error: err instanceof Error ? err.message : 'send failed' }, 502);
  }
});
