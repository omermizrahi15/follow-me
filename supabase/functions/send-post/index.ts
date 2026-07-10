/**
 * Supabase Edge Function: POST /send-post
 *
 * Sends a manually-approved post (batch of already-uploaded media URLs) to ONE
 * subscriber over WhatsApp. Called by the app once per subscriber after the
 * publisher confirms a post — Twilio credentials stay server-side (issue #24).
 *
 * Body: { publisherId: string, to: string (phone), mediaUrls: string[] }
 *
 * TODO(#24): verify the caller's Supabase JWT matches publisherId instead of
 * trusting the body (dev-grade, same posture as classify-photos).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
 *      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM.
 * Optional: TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET (preferred auth),
 *      TWILIO_STATUS_CALLBACK_URL (delivery tracking via twilio-status).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  credsFromEnv,
  sendBatch,
  sendWhatsApp,
  sendWhatsAppTemplate,
  whatsappSafeMediaUrl,
  TwilioSendError,
} from '../_shared/twilio.ts';
import { logAcceptedSend, logRejectedSend, markSubscriberUnreachable } from '../_shared/messageLog.ts';
import { buildPostTemplate } from '../_shared/postTemplate.ts';
import { composeAutoPostBody } from '../_shared/notificationBody.ts';
import { collageUrl } from '../_shared/collage.ts';
import { savePostGallery } from '../_shared/postGallery.ts';
import { validateSendPost } from './logic.ts';

// Supabase edge runtime: lets background work continue after the response is sent.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TWILIO = credsFromEnv(Deno.env);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function publisherIdentity(publisherId: string): Promise<{ name: string; phone?: string }> {
  // The profile's display name is what the publisher chose in the app; auth
  // metadata is only a fallback (often empty for email signups).
  let profileName = '';
  try {
    const { data } = await supabase
      .from('publisher_profile')
      .select('display_name')
      .eq('publisher_id', publisherId)
      .maybeSingle();
    profileName = (data as { display_name?: string } | null)?.display_name ?? '';
  } catch { /* fall through to auth metadata */ }
  try {
    const { data } = await supabase.auth.admin.getUserById(publisherId);
    const meta = (data.user?.user_metadata ?? {}) as { full_name?: string };
    return { name: profileName || meta.full_name || 'Your friend', phone: data.user?.phone };
  } catch {
    return { name: profileName || 'Your friend' };
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { publisherId?: string; to?: string; mediaUrls?: string[]; place?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const validation = validateSendPost(body);
  if (!validation.ok) return json({ error: validation.error }, 400);
  const { publisherId, to, mediaUrls, place } = validation.value;

  const { name, phone } = await publisherIdentity(publisherId);
  const galleryUrl = await savePostGallery(supabase, publisherId, mediaUrls);
  const caption = composeAutoPostBody(
    name,
    phone,
    galleryUrl != null ? { url: galleryUrl, photoCount: mediaUrls.length } : null,
    place,
  );

  // Preferred path: the whole batch as ONE message — a Cloudinary-composed
  // grid collage with the caption. Falls through to per-photo sends when the
  // URLs can't be collaged (non-Cloudinary source).
  // On a permanent Twilio failure (invalid/blocked number) the subscriber is
  // marked unreachable so future posts skip them and the app can surface it.
  async function recordPermanentFailure(err: TwilioSendError): Promise<void> {
    await logRejectedSend(supabase, { publisherId: publisherId!, contactHandle: to!, error: err });
    await markSubscriberUnreachable(supabase, publisherId!, to!);
  }

  async function recordAccepted(sid: string | null): Promise<void> {
    if (sid != null) {
      await logAcceptedSend(supabase, { sid, publisherId: publisherId!, contactHandle: to! });
    }
  }

  const collage = collageUrl(mediaUrls);
  if (collage != null) {
    // Preferred: an approved WhatsApp template (works outside the 24h session
    // window). Falls back to a free-form caption send when templates aren't
    // configured (sandbox / pre-approval).
    const template = buildPostTemplate(
      { postSid: TWILIO.templatePostSid, postLocationSid: TWILIO.templatePostLocationSid },
      { publisherName: name, publisherPhone: phone, place, photoCount: mediaUrls.length, galleryUrl, mediaUrl: collage },
    );
    try {
      const { sid } = template != null
        ? await sendWhatsAppTemplate(TWILIO, to, template.contentSid, template.variables)
        : await sendWhatsApp(TWILIO, to, caption, collage);
      await recordAccepted(sid);
    } catch (err) {
      console.error(`send-post collage to ${to} failed:`, err);
      if (err instanceof TwilioSendError && err.permanent) {
        await recordPermanentFailure(err);
        return json({ error: err.message, unreachable: true }, 502);
      }
      return json({ error: err instanceof Error ? err.message : 'send failed' }, 502);
    }
    return json({ sent: 1, photos: mediaUrls.length, collage: true });
  }

  // Send the first message synchronously so pipeline errors (bad creds, expired
  // sandbox join, bad number) surface to the app; the rest go out in the
  // background, paced ~1 msg/sec to respect Twilio's WhatsApp throttle.
  const [first, ...rest] = mediaUrls;
  try {
    const { sid } = await sendWhatsApp(TWILIO, to, caption, whatsappSafeMediaUrl(first ?? ''));
    await recordAccepted(sid);
  } catch (err) {
    console.error(`send-post to ${to} failed:`, err);
    if (err instanceof TwilioSendError && err.permanent) {
      await recordPermanentFailure(err);
      return json({ error: err.message, unreachable: true }, 502);
    }
    return json({ error: err instanceof Error ? err.message : 'send failed' }, 502);
  }

  if (rest.length > 0) {
    const sendRest = new Promise(resolve => setTimeout(resolve, 1100))
      .then(() => sendBatch(TWILIO, to, '', rest))
      .then(async result => {
        for (const sid of result.sids) await recordAccepted(sid);
        if (result.permanentError != null) await recordPermanentFailure(result.permanentError);
        if (result.failed > 0) {
          console.error(`send-post to ${to}: ${result.failed}/${rest.length} background sends failed:`, result.errors);
        }
      });
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(sendRest);
    else await sendRest;
  }

  return json({ sent: 1, queued: rest.length });
});
