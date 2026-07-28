/**
 * Supabase Edge Function: POST /auto-post  (invoked by pg_cron every ~15 min)
 *
 * For each publisher who turned OFF "Ask before posting" and whose schedule is
 * due, it selects a batch from their cloud-synced candidate photos, sends it to
 * followers on WhatsApp, and records the send. If no batch is available it pushes
 * the publisher a reminder to pick photos manually. Zero device involvement.
 *
 * Guarded by a shared CRON_SECRET so only the scheduler can trigger it.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected), CRON_SECRET,
 *      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM.
 * Optional: TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET (preferred auth),
 *      TWILIO_STATUS_CALLBACK_URL (delivery tracking via twilio-status).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { selectBatch, type SharedClassification } from '../_shared/photoSelection.ts';
import { isAutoPostDue } from '../_shared/autoPostSchedule.ts';
import { credsFromEnv, sendBatch, sendWhatsApp, sendWhatsAppTemplate, TwilioSendError } from '../_shared/twilio.ts';
import { logAcceptedSend, logRejectedSend, markSubscriberUnreachable } from '../_shared/messageLog.ts';
import { buildPostTemplate } from '../_shared/postTemplate.ts';
import { collageUrl } from '../_shared/collage.ts';
import { savePostGallery } from '../_shared/postGallery.ts';
import { composeAutoPostBody } from '../_shared/notificationBody.ts';
import { publisherIdentity } from '../_shared/publisher.ts';
import { galleryUrls, saveApprovalBatch } from '../_shared/approvalBatch.ts';
import { resolveBatchPlace } from '../_shared/geocode.ts';
import type { Coordinate } from '../_shared/postingLocation.ts';
import { approvalPushContent, parseNotifyTime, reminderPushContent, type ReminderReason } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const TWILIO = credsFromEnv(Deno.env);
const CLASSIFY_URL = `${SUPABASE_URL}/functions/v1/classify-photos`;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface ConfigRow {
  publisher_id: string;
  require_approval: boolean;
  photos_per_post: number;
  notify_day_of_week: number;
  notify_time: string;
  enabled_categories: string[];
  lookback_days: number;
  min_quality: number;
  timezone: string;
  expo_push_token: string | null;
  last_auto_post_at: string | null;
}

interface CandidateRow {
  asset_id: string;
  url: string;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
}

/** Coordinates of the given asset ids (GPS-tagged photos only), for place naming. */
function coordsForAssets(rows: CandidateRow[], assetIds: Iterable<string>): Coordinate[] {
  const byId = new Map(rows.map(r => [r.asset_id, r]));
  const coords: Coordinate[] = [];
  for (const id of assetIds) {
    const row = byId.get(id);
    if (row?.latitude != null && row.longitude != null) {
      coords.push({ latitude: row.latitude, longitude: row.longitude });
    }
  }
  return coords;
}

interface RawClassification {
  id: string;
  category: SharedClassification['category'];
  confidence: number;
  quality: number;
  caption: string;
  scene: string;
}

async function classify(photos: { id: string; url: string }[]): Promise<RawClassification[]> {
  const res = await fetch(CLASSIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ photos }),
  });
  if (!res.ok) throw new Error(`classify-photos failed (${res.status})`);
  const body = (await res.json()) as { classifications?: RawClassification[] };
  return body.classifications ?? [];
}

async function pushReminder(token: string, reason: ReminderReason): Promise<void> {
  if (!token) return;
  const { title, body } = reminderPushContent(reason);
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      title,
      body,
      data: { screen: 'ReviewSuggestion' },
    }),
  });
}

interface BatchPhoto {
  id: string;
  url: string;
  category: string;
  caption: string;
  quality: number;
  scene: string;
  createdAt: number;
}

/**
 * Persist the batch and send the rich approval push. The push stays under the
 * APNs 4KB limit by carrying only `batchId` + a compact `gallery` (URLs the
 * content extension renders) + the lead `imageUrl` (thumbnail) — the app fetches
 * the full batch/pool from `approval_batches` by id (issue #71). Skipped when
 * the publisher has no push token.
 */
async function pushApprovalBatch(
  token: string,
  publisherId: string,
  batch: BatchPhoto[],
  pool: BatchPhoto[],
  place: string | null,
): Promise<void> {
  if (!token) return;

  const batchId = crypto.randomUUID();
  // Persist first: the app reads the batch from here, so a push that referenced
  // a missing row would open an empty review screen.
  await saveApprovalBatch(supabase, batchId, publisherId, batch, pool);

  // Build a readable summary from captions (e.g. "Sunset · Street food · Mountain view"),
  // titled with the batch's reverse-geocoded location when the photos carried GPS
  // ("3 photos from Tel Aviv ready to post 📸" — issue #23).
  const { title, body } = approvalPushContent(batch.map(p => p.caption), batch.length, place);

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      title,
      body,
      sound: 'default',
      categoryId: 'post-review',
      // mutableContent tells iOS to hand off to the NotificationServiceExtension
      // which downloads `imageUrl` and attaches it as a rich image.
      mutableContent: true,
      data: {
        screen: 'ReviewSuggestion',
        publisherId,
        batchId,
        // Compact gallery for the NotificationContentExtension's expanded grid;
        // full batch/pool detail is fetched by the app from approval_batches.
        gallery: galleryUrls(batch),
        imageUrl: batch[0]?.url ?? null,
      },
    }),
  });
}

/** Process a publisher who requires approval: compute the batch and send a rich push. */
async function processApprovalPublisher(config: ConfigRow, now: Date): Promise<string> {
  const { hour, minute } = parseNotifyTime(config.notify_time);
  const due = isAutoPostDue(
    {
      dayOfWeek: config.notify_day_of_week,
      hour,
      minute,
      timezone: config.timezone,
      intervalDays: config.lookback_days,
      lastAutoPostAt: config.last_auto_post_at != null ? new Date(config.last_auto_post_at) : null,
    },
    now,
  );
  if (!due) return 'not-due';

  const token = config.expo_push_token ?? '';
  if (!token) return 'skipped (no push token)';

  const cutoff = new Date(now.getTime() - config.lookback_days * MS_PER_DAY).toISOString();
  const { data: candidates } = await supabase
    .from('candidate_photos')
    .select('asset_id, url, created_at, latitude, longitude')
    .eq('publisher_id', config.publisher_id)
    .gte('created_at', cutoff);
  const rows = (candidates ?? []) as CandidateRow[];

  const stamp = async (): Promise<void> => {
    await supabase
      .from('publisher_config')
      .update({ last_auto_post_at: now.toISOString() })
      .eq('publisher_id', config.publisher_id);
  };

  if (rows.length === 0) {
    await pushReminder(token, 'no-candidates');
    await stamp();
    return 'reminder (no candidates)';
  }

  const { data: sentRows } = await supabase
    .from('media')
    .select('id')
    .eq('owner_id', config.publisher_id);
  const alreadySent = new Set((sentRows ?? []).map((r: { id: string }) => r.id));

  const classified = await classify(rows.map(r => ({ id: r.asset_id, url: r.url })));
  const byId = new Map(rows.map(r => [r.asset_id, r]));

  const sharedClassifications: SharedClassification[] = classified
    .map((c): SharedClassification | null => {
      const cand = byId.get(c.id);
      if (cand == null) return null;
      return {
        assetId: c.id,
        url: cand.url,
        category: c.category,
        confidence: c.confidence,
        quality: c.quality,
        createdAt: Date.parse(cand.created_at),
        scene: c.scene ?? '',
      };
    })
    .filter((c): c is SharedClassification => c !== null);

  const selectedBatch = selectBatch(
    sharedClassifications,
    {
      enabledCategories: config.enabled_categories as SharedClassification['category'][],
      minQuality: config.min_quality,
      photosPerPost: config.photos_per_post,
    },
    alreadySent,
  );

  if (selectedBatch.length === 0) {
    await pushReminder(token, 'empty-batch');
    await stamp();
    return 'reminder (empty batch)';
  }

  // Build the caption lookup from raw classifications.
  const captionById = new Map(classified.map(c => [c.id, c.caption ?? '']));

  const batchSelectedIds = new Set(selectedBatch.map(b => b.assetId));
  const batchPayload: BatchPhoto[] = selectedBatch.map(b => ({
    id: b.assetId,
    url: b.url,
    category: b.category,
    caption: captionById.get(b.assetId) ?? '',
    quality: b.quality,
    scene: b.scene,
    createdAt: b.createdAt,
  }));

  // Include up to 2× batch size as pool alternatives.
  const poolPayload: BatchPhoto[] = sharedClassifications
    .filter(c => !batchSelectedIds.has(c.assetId) && !alreadySent.has(c.assetId))
    .sort((a, b) => b.quality - a.quality)
    .slice(0, config.photos_per_post * 2)
    .map(c => ({
      id: c.assetId,
      url: c.url,
      category: c.category,
      caption: captionById.get(c.assetId) ?? '',
      quality: c.quality,
      scene: c.scene,
      createdAt: c.createdAt,
    }));

  // Name the batch's place from the selected photos' GPS (issue #23) — null when
  // none were geotagged or the lookup fails; the push just omits the location then.
  const place = await resolveBatchPlace(coordsForAssets(rows, batchSelectedIds));

  await pushApprovalBatch(token, config.publisher_id, batchPayload, poolPayload, place);
  await stamp();
  return `pushed ${selectedBatch.length} photos (${poolPayload.length} in pool)`;
}

async function processAutoPublisher(config: ConfigRow, now: Date): Promise<string> {
  const { hour, minute } = parseNotifyTime(config.notify_time);
  const due = isAutoPostDue(
    {
      dayOfWeek: config.notify_day_of_week,
      hour,
      minute,
      timezone: config.timezone,
      intervalDays: config.lookback_days,
      lastAutoPostAt: config.last_auto_post_at != null ? new Date(config.last_auto_post_at) : null,
    },
    now,
  );
  if (!due) return 'not-due';

  const cutoff = new Date(now.getTime() - config.lookback_days * MS_PER_DAY).toISOString();
  const { data: candidates } = await supabase
    .from('candidate_photos')
    .select('asset_id, url, created_at, latitude, longitude')
    .eq('publisher_id', config.publisher_id)
    .gte('created_at', cutoff);
  const rows = (candidates ?? []) as CandidateRow[];

  const stamp = async (): Promise<void> => {
    await supabase
      .from('publisher_config')
      .update({ last_auto_post_at: now.toISOString() })
      .eq('publisher_id', config.publisher_id);
  };

  if (rows.length === 0) {
    await pushReminder(config.expo_push_token ?? '', 'no-candidates');
    await stamp();
    return 'reminder (no candidates)';
  }

  // Already-sent = anything already in `media` for this publisher (id == asset_id).
  const { data: sentRows } = await supabase
    .from('media')
    .select('id')
    .eq('owner_id', config.publisher_id);
  const alreadySent = new Set((sentRows ?? []).map((r: { id: string }) => r.id));

  const classified = await classify(rows.map(r => ({ id: r.asset_id, url: r.url })));
  const byId = new Map(rows.map(r => [r.asset_id, r]));
  const classifications: SharedClassification[] = classified
    .map((c): SharedClassification | null => {
      const cand = byId.get(c.id);
      if (cand == null) return null;
      return {
        assetId: c.id,
        url: cand.url,
        category: c.category,
        confidence: c.confidence,
        quality: c.quality,
        createdAt: Date.parse(cand.created_at),
        scene: c.scene ?? '',
      };
    })
    .filter((c): c is SharedClassification => c !== null);

  const batch = selectBatch(
    classifications,
    {
      enabledCategories: config.enabled_categories as SharedClassification['category'][],
      minQuality: config.min_quality,
      photosPerPost: config.photos_per_post,
    },
    alreadySent,
  );

  if (batch.length === 0) {
    await pushReminder(config.expo_push_token ?? '', 'empty-batch');
    await stamp();
    return 'reminder (empty batch)';
  }

  const { name, phone } = await publisherIdentity(supabase, config.publisher_id);
  const urls = batch.map(b => b.url);
  // Name the batch's place from the selected photos' GPS (issue #23) — null when
  // none were geotagged; the message/template then omits the location clause.
  const place = await resolveBatchPlace(coordsForAssets(rows, batch.map(b => b.assetId)));
  const galleryUrl = await savePostGallery(supabase, config.publisher_id, urls);
  const caption = composeAutoPostBody(
    name,
    phone,
    galleryUrl != null ? { url: galleryUrl, photoCount: urls.length } : null,
    place,
  );

  const { data: subs } = await supabase
    .from('subscribers')
    .select('contact_handle')
    .eq('publisher_id', config.publisher_id)
    .eq('status', 'active');

  // One collage message per subscriber when possible; per-photo fallback
  // otherwise. A permanently unreachable number (invalid/blocked) is marked
  // 'unreachable' and never stops the rest of the fan-out.
  const publisherId = config.publisher_id;
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
        { postSid: TWILIO.templatePostSid, postLocationSid: TWILIO.templatePostLocationSid },
        { publisherName: name, publisherPhone: phone, place, photoCount: urls.length, galleryUrl, mediaUrl: collage },
      )
    : null;
  for (const sub of (subs ?? []) as { contact_handle: string }[]) {
    if (collage != null) {
      try {
        const { sid } = template != null
          ? await sendWhatsAppTemplate(TWILIO, sub.contact_handle, template.contentSid, template.variables)
          : await sendWhatsApp(TWILIO, sub.contact_handle, caption, collage);
        await recordAccepted(sub.contact_handle, sid);
      } catch (err) {
        console.error(`auto-post collage to ${sub.contact_handle} failed:`, err);
        if (err instanceof TwilioSendError && err.permanent) {
          await recordPermanentFailure(sub.contact_handle, err);
        }
      }
    } else {
      const result = await sendBatch(TWILIO, sub.contact_handle, caption, urls);
      for (const sid of result.sids) await recordAccepted(sub.contact_handle, sid);
      if (result.permanentError != null) {
        await recordPermanentFailure(sub.contact_handle, result.permanentError);
      }
      if (result.failed > 0) {
        console.error(`auto-post to ${sub.contact_handle}: ${result.failed}/${urls.length} sends failed:`, result.errors);
      }
    }
  }

  // Carry the candidate's GPS onto the published row (issue #78) so the
  // Me-page globe can plot autonomously posted batches too — until now the
  // coordinate was used to name the place and then dropped. `place` is stored
  // alongside it so the feed shows the same label the message did.
  // One posting_id for the whole batch, like ShareMediaUseCase stamps on the
  // manual path. Without it every photo falls back to the column default and
  // becomes its own single-item posting — which on the globe means N markers
  // stacked on one spot joined by zero-length route segments.
  const candidateById = new Map(rows.map(r => [r.asset_id, r]));
  const postingId = `posting-auto-${config.publisher_id}-${now.getTime().toString(36)}`;
  await supabase.from('media').upsert(
    batch.map(b => {
      const candidate = candidateById.get(b.assetId);
      return {
        id: b.assetId,
        owner_id: config.publisher_id,
        url: b.url,
        created_at: new Date(b.createdAt).toISOString(),
        posting_id: postingId,
        location: place,
        latitude: candidate?.latitude ?? null,
        longitude: candidate?.longitude ?? null,
      };
    }),
  );
  await stamp();
  return `posted ${batch.length} to ${(subs ?? []).length} subscribers`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const now = new Date();

  // Retention: candidate photos exist only to serve the lookback window —
  // garbage-collect anything older than the longest window (+ slack) on every
  // cron tick. (Cloudinary assets are cleaned by delete-candidates / manually.)
  const RETENTION_DAYS = 35;
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY).toISOString();
  const { error: pruneError } = await supabase
    .from('candidate_photos')
    .delete()
    .lt('created_at', cutoff);
  if (pruneError != null) console.error('candidate_photos retention prune failed:', pruneError.message);

  const { data: configs, error } = await supabase
    .from('publisher_config')
    .select(
      'publisher_id, require_approval, photos_per_post, notify_day_of_week, notify_time, enabled_categories, lookback_days, min_quality, timezone, expo_push_token, last_auto_post_at',
    );
  if (error != null) return json({ error: error.message }, 500);

  const results: Record<string, string> = {};
  for (const config of (configs ?? []) as ConfigRow[]) {
    try {
      results[config.publisher_id] = config.require_approval
        ? await processApprovalPublisher(config, now)
        : await processAutoPublisher(config, now);
    } catch (err) {
      console.error(`auto-post ${config.publisher_id} failed:`, err);
      results[config.publisher_id] = `error: ${err instanceof Error ? err.message : 'unknown'}`;
    }
  }

  return json({ ran_at: now.toISOString(), results });
});
