/**
 * Publishing a batch of cloud-synced photos to a publisher's followers — the
 * device-free half of a post: WhatsApp fan-out, delivery logging and the
 * `media` rows that make it show up in the feed.
 *
 * Two callers share it: the autonomous cron path (`auto-post`, publishers who
 * turned "Ask before posting" off) and `post-batch`, which the app fires when
 * the publisher hits "Post now" on an approval push. That action used to open
 * the app and re-run the whole scan/classify/upload on the device; the photos
 * are already in the cloud, so the same fan-out serves both and the phone only
 * has to make one HTTP call.
 */
import { credsFromEnv, sendBatch, sendWhatsApp, sendWhatsAppTemplate, TwilioSendError, type TwilioCreds } from './twilio.ts';
import { logAcceptedSend, logRejectedSend, markSubscriberUnreachable } from './messageLog.ts';
import { buildPostTemplate } from './postTemplate.ts';
import { collageUrl } from './collage.ts';
import { savePostGallery } from './postGallery.ts';
import { composeAutoPostBody } from './notificationBody.ts';
import { publisherIdentity } from './publisher.ts';
import type { Coordinate } from './postingLocation.ts';

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/** One photo of the batch being published, already uploaded to the cloud. */
export interface PublishablePhoto {
  /** Media library asset id — doubles as the `media` row's primary key. */
  id: string;
  url: string;
  /** Epoch ms the photo was taken. */
  createdAt: number;
  coordinate?: Coordinate | null;
}

export interface PublishResult {
  postingId: string;
  photoCount: number;
  subscriberCount: number;
}

/**
 * One posting id for the whole batch, matching the shape ShareMediaUseCase
 * stamps on the manual path. Without a shared id every photo falls back to the
 * column default and becomes its own single-item posting — which on the globe
 * means N markers stacked on one spot joined by zero-length route segments.
 */
export function postingIdFor(source: string, publisherId: string, at: Date): string {
  return `posting-${source}-${publisherId}-${at.getTime().toString(36)}`;
}

/** Twilio creds from the ambient environment — the same wiring every function uses. */
export function twilioFromEnv(): TwilioCreds {
  return credsFromEnv(Deno.env);
}

/**
 * Send `photos` to every active subscriber and record the posting.
 *
 * Delivery mirrors the autonomous path exactly: one collage message per
 * subscriber when the photos can be tiled, per-photo fallback otherwise, and a
 * permanently unreachable number (invalid/blocked) is marked and skipped
 * without stopping the rest of the fan-out.
 */
export async function publishBatch(
  supabase: SupabaseClient,
  twilio: TwilioCreds,
  options: {
    publisherId: string;
    photos: PublishablePhoto[];
    place: string | null;
    postingId: string;
    now: Date;
  },
): Promise<PublishResult> {
  const { publisherId, photos, place, postingId, now } = options;
  const { name, phone } = await publisherIdentity(supabase, publisherId);
  const urls = photos.map(p => p.url);

  // The posting id goes onto the gallery row too, so trashing this post later
  // hides it from followers and not just from the publisher's own feed.
  const galleryUrl = await savePostGallery(supabase, publisherId, urls, place, postingId);
  const caption = composeAutoPostBody(
    name,
    phone,
    galleryUrl != null ? { url: galleryUrl, photoCount: urls.length } : null,
    place,
  );

  const { data: subs } = await supabase
    .from('subscribers')
    .select('contact_handle')
    .eq('publisher_id', publisherId)
    .eq('status', 'active');
  const subscribers = (subs ?? []) as { contact_handle: string }[];

  const recordAccepted = async (contactHandle: string, sid: string | null): Promise<void> => {
    if (sid != null) await logAcceptedSend(supabase, { sid, publisherId, contactHandle });
  };
  const recordPermanentFailure = async (contactHandle: string, err: TwilioSendError): Promise<void> => {
    await logRejectedSend(supabase, { publisherId, contactHandle, error: err });
    await markSubscriberUnreachable(supabase, publisherId, contactHandle);
  };

  const collage = collageUrl(urls);
  // Approved template (works out-of-session); same for every subscriber since
  // the variables don't depend on the recipient. Null → free-form fallback.
  const template = collage != null
    ? buildPostTemplate(
        { postSid: twilio.templatePostSid, postLocationSid: twilio.templatePostLocationSid },
        { publisherName: name, publisherPhone: phone, place, photoCount: urls.length, galleryUrl, mediaUrl: collage },
      )
    : null;

  for (const sub of subscribers) {
    if (collage != null) {
      try {
        const { sid } = template != null
          ? await sendWhatsAppTemplate(twilio, sub.contact_handle, template.contentSid, template.variables)
          : await sendWhatsApp(twilio, sub.contact_handle, caption, collage);
        await recordAccepted(sub.contact_handle, sid);
      } catch (err) {
        console.error(`publishBatch collage to ${sub.contact_handle} failed:`, err);
        if (err instanceof TwilioSendError && err.permanent) {
          await recordPermanentFailure(sub.contact_handle, err);
        }
      }
    } else {
      const result = await sendBatch(twilio, sub.contact_handle, caption, urls);
      for (const sid of result.sids) await recordAccepted(sub.contact_handle, sid);
      if (result.permanentError != null) {
        await recordPermanentFailure(sub.contact_handle, result.permanentError);
      }
      if (result.failed > 0) {
        console.error(`publishBatch to ${sub.contact_handle}: ${result.failed}/${urls.length} sends failed:`, result.errors);
      }
    }
  }

  // The candidate's GPS is carried onto the published row (issue #78) so the
  // Me-page globe can plot server-published batches too — until now the
  // coordinate was used to name the place and then dropped. `place` is stored
  // alongside it so the feed shows the same label the message did.
  await supabase.from('media').upsert(
    photos.map(p => ({
      id: p.id,
      owner_id: publisherId,
      url: p.url,
      created_at: new Date(p.createdAt).toISOString(),
      posting_id: postingId,
      location: place,
      latitude: p.coordinate?.latitude ?? null,
      longitude: p.coordinate?.longitude ?? null,
    })),
  );

  console.log(
    `publishBatch: ${publisherId} — ${photos.length} photos to ${subscribers.length} subscribers as ${postingId} (${now.toISOString()})`,
  );
  return { postingId, photoCount: photos.length, subscriberCount: subscribers.length };
}
