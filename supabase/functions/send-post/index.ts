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
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendBatch, sendWhatsApp, whatsappSafeMediaUrl, type TwilioCreds } from '../_shared/twilio.ts';
import { composeAutoPostBody } from '../_shared/notificationBody.ts';
import { collageUrl } from '../_shared/collage.ts';
import { savePostGallery } from '../_shared/postGallery.ts';

// Supabase edge runtime: lets background work continue after the response is sent.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TWILIO: TwilioCreds = {
  accountSid: Deno.env.get('TWILIO_ACCOUNT_SID') ?? '',
  authToken: Deno.env.get('TWILIO_AUTH_TOKEN') ?? '',
  fromNumber: Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '',
};

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

  const { publisherId, to, mediaUrls, place } = body;
  if (!publisherId || !to || !Array.isArray(mediaUrls) || mediaUrls.length === 0) {
    return json({ error: 'publisherId, to and non-empty mediaUrls are required' }, 400);
  }
  if (mediaUrls.some(u => typeof u !== 'string' || !u.startsWith('https://'))) {
    return json({ error: 'mediaUrls must be https URLs' }, 400);
  }

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
  const collage = collageUrl(mediaUrls);
  if (collage != null) {
    try {
      await sendWhatsApp(TWILIO, to, caption, collage);
    } catch (err) {
      console.error(`send-post collage to ${to} failed:`, err);
      return json({ error: err instanceof Error ? err.message : 'send failed' }, 502);
    }
    return json({ sent: 1, photos: mediaUrls.length, collage: true });
  }

  // Send the first message synchronously so pipeline errors (bad creds, expired
  // sandbox join, bad number) surface to the app; the rest go out in the
  // background, paced ~1 msg/sec to respect Twilio's WhatsApp throttle.
  const [first, ...rest] = mediaUrls;
  try {
    await sendWhatsApp(TWILIO, to, caption, whatsappSafeMediaUrl(first ?? ''));
  } catch (err) {
    console.error(`send-post to ${to} failed:`, err);
    return json({ error: err instanceof Error ? err.message : 'send failed' }, 502);
  }

  if (rest.length > 0) {
    const sendRest = new Promise(resolve => setTimeout(resolve, 1100))
      .then(() => sendBatch(TWILIO, to, '', rest))
      .then(result => {
        if (result.failed > 0) {
          console.error(`send-post to ${to}: ${result.failed}/${rest.length} background sends failed:`, result.errors);
        }
      });
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(sendRest);
    else await sendRest;
  }

  return json({ sent: 1, queued: rest.length });
});
