/**
 * Supabase Edge Function: POST /auto-post  (invoked by pg_cron every ~15 min)
 *
 * For each publisher who turned OFF "Ask before posting" and whose schedule is
 * due, it selects a batch from their cloud-synced candidate photos, sends it to
 * followers on WhatsApp, and records the send. Zero device involvement.
 *
 * When a posting comes due and the cloud photo set is empty, the slot is held
 * open for a grace window (issue #97) rather than immediately spending it on a
 * contentless reminder: the job wakes the phone with a silent push and re-checks
 * every tick, so a late sync still becomes a real post. The reminder is the last
 * resort — see holdForSync.
 *
 * Guarded by a shared CRON_SECRET so only the scheduler can trigger it.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected), CRON_SECRET,
 *      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM.
 * Optional: TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET (preferred auth),
 *      TWILIO_STATUS_CALLBACK_URL (delivery tracking via twilio-status).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { selectBatch, type PhotoFacts } from '../../../src/domain/services/photoSelection.ts';
import { isAutoPostDue } from '../../../src/domain/services/autoPostSchedule.ts';
import { credsFromEnv } from '../../../src/infrastructure/notifiers/twilioClient.ts';
import { postingIdFor, publishBatch } from '../_shared/publishBatch.ts';
import { galleryUrls, saveApprovalBatch } from '../_shared/approvalBatch.ts';
import { resolveBatchPlace } from '../_shared/geocode.ts';
import type { Coordinate } from '../../../src/domain/services/postingLocation.ts';
import {
  approvalPushContent,
  parseNotifyTime,
  reminderPushContent,
  syncGraceDecision,
  type ReminderReason,
} from './logic.ts';

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
  // Sync grace window (issue #97) — see migration 20240026.
  post_pending_since: string | null;
  last_wake_push_at: string | null;
  last_candidate_sync_at: string | null;
  // Whether the device is uploading photos at all — see migration 20240027.
  photo_sync_state: string | null;
}

/** Narrow the free-text column to the states the decision logic knows about. */
function parseSyncState(value: string | null): 'active' | 'paused' | 'no-consent' | null {
  return value === 'active' || value === 'paused' || value === 'no-consent' ? value : null;
}

function parseDate(value: string | null): Date | null {
  return value != null ? new Date(value) : null;
}

async function updateConfig(publisherId: string, patch: Record<string, string | null>): Promise<void> {
  await supabase.from('publisher_config').update(patch).eq('publisher_id', publisherId);
}

/** Whether the publisher published anything (by any route) since the given moment. */
async function postedSince(publisherId: string, since: Date): Promise<boolean> {
  const { count } = await supabase
    .from('media')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', publisherId)
    .gte('created_at', since.toISOString());
  return (count ?? 0) > 0;
}

/**
 * Decide whether a publisher whose due window has closed should still be
 * processed because a posting slot is being held open for a late sync.
 *
 * The slot is released — and the schedule stamped as spent — if they posted by
 * hand in the meantime. Otherwise the most likely sequence is the worst one:
 * nothing synced at 18:00, the user opens the app at 19:00 and posts manually
 * (which syncs their photos as a side effect), and the very next cron tick
 * pushes "10 photos ready to post" at somebody who just posted.
 */
async function pendingSlotStillOpen(config: ConfigRow, now: Date): Promise<boolean> {
  const pendingSince = parseDate(config.post_pending_since);
  if (pendingSince == null) return false;
  if (!(await postedSince(config.publisher_id, pendingSince))) return true;
  await updateConfig(config.publisher_id, {
    last_auto_post_at: now.toISOString(),
    post_pending_since: null,
    last_wake_push_at: null,
  });
  return false;
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
  category: string;
  confidence: number;
  quality: number;
  caption: string;
  scene: string;
}

/** A candidate row joined to its classification — what a batch is made of. */
interface ClassifiedCandidate {
  assetId: string;
  url: string;
  category: string;
  confidence: number;
  quality: number;
  /** epoch ms */
  createdAt: number;
  scene: string;
}

/** How this shape answers the selection rules' questions (see photoSelection). */
const selectionFacts = (c: ClassifiedCandidate): PhotoFacts => ({
  id: c.assetId,
  category: c.category,
  quality: c.quality,
  createdAt: c.createdAt,
  scene: c.scene,
});

/** Joins classify-photos' verdicts back onto the candidate rows they came from. */
function classifiedCandidates(
  classified: RawClassification[],
  rows: CandidateRow[],
): ClassifiedCandidate[] {
  const byId = new Map(rows.map(r => [r.asset_id, r]));
  const joined: ClassifiedCandidate[] = [];
  for (const c of classified) {
    const cand = byId.get(c.id);
    if (cand == null) continue;
    joined.push({
      assetId: c.id,
      url: cand.url,
      category: c.category,
      confidence: c.confidence,
      quality: c.quality,
      createdAt: Date.parse(cand.created_at),
      scene: c.scene ?? '',
    });
  }
  return joined;
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

/**
 * Silent push that wakes the app to sync its recent photos (issue #97).
 *
 * No title/body, so nothing is shown: `_contentAvailable` is Expo's spelling of
 * the APNs `content-available: 1` flag, which asks iOS to launch/resume the app
 * in the background and hand the payload to its background notification task.
 * `priority: 'normal'` maps to apns-priority 5, which is what Apple requires for
 * background pushes — a high-priority silent push gets throttled harder.
 *
 * Delivery is explicitly best-effort: iOS budgets these per app and may drop
 * them entirely on a low battery. That's why it's a nudge inside a grace window
 * and not the mechanism the posting depends on.
 */
async function pushSyncWake(token: string): Promise<void> {
  if (!token) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      data: { type: 'sync-candidates' },
      _contentAvailable: true,
      priority: 'normal',
    }),
  });
}

/**
 * A posting came due but the publisher's cloud photo set is empty.
 *
 * Before issue #97 this sent the "nothing has synced" reminder immediately and
 * stamped the schedule, so a phone that synced ten minutes later still waited a
 * full interval for its next chance — and the user got a push that looked like
 * a batch notification but carried no photo, place, or gallery.
 *
 * Now the slot is held open: the job records `post_pending_since`, wakes the
 * device with a throttled silent push, and returns. Because `post_pending_since`
 * is set, later cron ticks re-enter this publisher even though the 30-minute due
 * window has closed, and the real batch goes out the moment photos land. Only
 * when the grace window expires does a reminder go out — once, and worded for
 * what actually happened.
 */
async function holdForSync(config: ConfigRow, now: Date, stamp: () => Promise<void>): Promise<string> {
  const token = config.expo_push_token ?? '';
  const decision = syncGraceDecision({
    pendingSince: parseDate(config.post_pending_since),
    lastWakePushAt: parseDate(config.last_wake_push_at),
    lastClientSyncAt: parseDate(config.last_candidate_sync_at),
    syncState: parseSyncState(config.photo_sync_state),
    now,
  });

  if (decision.kind === 'give-up') {
    await pushReminder(token, decision.reason);
    await stamp();
    return `reminder (${decision.reason})`;
  }

  if (decision.nudge) await pushSyncWake(token);
  await updateConfig(config.publisher_id, {
    // Keep the original timestamp so the grace window measures from first sight.
    post_pending_since: config.post_pending_since ?? now.toISOString(),
    ...(decision.nudge ? { last_wake_push_at: now.toISOString() } : {}),
  });
  return decision.nudge ? 'waiting for sync (device woken)' : 'waiting for sync';
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
  // A pending slot keeps this publisher in play after the 30-minute due window
  // closes, so a late sync still becomes a real post (issue #97).
  if (!due && !(await pendingSlotStillOpen(config, now))) return 'not-due';

  const token = config.expo_push_token ?? '';
  if (!token) {
    // Nothing can be delivered to this publisher, so don't leave a pending slot
    // behind to re-enter on every tick forever.
    if (config.post_pending_since != null) {
      await updateConfig(config.publisher_id, { post_pending_since: null, last_wake_push_at: null });
    }
    return 'skipped (no push token)';
  }

  const cutoff = new Date(now.getTime() - config.lookback_days * MS_PER_DAY).toISOString();
  const { data: candidates } = await supabase
    .from('candidate_photos')
    .select('asset_id, url, created_at, latitude, longitude')
    .eq('publisher_id', config.publisher_id)
    .gte('created_at', cutoff);
  const rows = (candidates ?? []) as CandidateRow[];

  const stamp = async (): Promise<void> => {
    await updateConfig(config.publisher_id, {
      last_auto_post_at: now.toISOString(),
      // The slot is settled either way — release the grace state with it.
      post_pending_since: null,
      last_wake_push_at: null,
    });
  };

  if (rows.length === 0) return holdForSync(config, now, stamp);

  const { data: sentRows } = await supabase
    .from('media')
    .select('id')
    .eq('owner_id', config.publisher_id);
  const alreadySent = new Set((sentRows ?? []).map((r: { id: string }) => r.id));

  const classified = await classify(rows.map(r => ({ id: r.asset_id, url: r.url })));
  const classifiedRows = classifiedCandidates(classified, rows);

  const selectedBatch = selectBatch(
    classifiedRows,
    selectionFacts,
    {
      enabledCategories: config.enabled_categories,
      photosPerPost: config.photos_per_post,
    },
    alreadySent,
  );

  // No grace window here, unlike the empty-cloud-set case: the photos ARE
  // synced, they just don't pass the publisher's filters. Waiting re-runs
  // classification (a paid Gemini call per photo) every cron tick to reach the
  // same verdict, so say so now.
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
  const poolPayload: BatchPhoto[] = classifiedRows
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
  // See processApprovalPublisher: a pending slot outlives the due window.
  if (!due && !(await pendingSlotStillOpen(config, now))) return 'not-due';

  const cutoff = new Date(now.getTime() - config.lookback_days * MS_PER_DAY).toISOString();
  const { data: candidates } = await supabase
    .from('candidate_photos')
    .select('asset_id, url, created_at, latitude, longitude')
    .eq('publisher_id', config.publisher_id)
    .gte('created_at', cutoff);
  const rows = (candidates ?? []) as CandidateRow[];

  const stamp = async (): Promise<void> => {
    await updateConfig(config.publisher_id, {
      last_auto_post_at: now.toISOString(),
      post_pending_since: null,
      last_wake_push_at: null,
    });
  };

  if (rows.length === 0) return holdForSync(config, now, stamp);

  // Already-sent = anything already in `media` for this publisher (id == asset_id).
  const { data: sentRows } = await supabase
    .from('media')
    .select('id')
    .eq('owner_id', config.publisher_id);
  const alreadySent = new Set((sentRows ?? []).map((r: { id: string }) => r.id));

  const classified = await classify(rows.map(r => ({ id: r.asset_id, url: r.url })));

  const batch = selectBatch(
    classifiedCandidates(classified, rows),
    selectionFacts,
    {
      enabledCategories: config.enabled_categories,
      photosPerPost: config.photos_per_post,
    },
    alreadySent,
  );

  // Synced but unusable — see the same branch in processApprovalPublisher for
  // why this one doesn't get a grace window.
  if (batch.length === 0) {
    await pushReminder(config.expo_push_token ?? '', 'empty-batch');
    await stamp();
    return 'reminder (empty batch)';
  }

  // Name the batch's place from the selected photos' GPS (issue #23) — null when
  // none were geotagged; the message/template then omits the location clause.
  const place = await resolveBatchPlace(coordsForAssets(rows, batch.map(b => b.assetId)));

  const candidateById = new Map(rows.map(r => [r.asset_id, r]));
  const result = await publishBatch(supabase, TWILIO, {
    publisherId: config.publisher_id,
    photos: batch.map(b => {
      const candidate = candidateById.get(b.assetId);
      return {
        id: b.assetId,
        url: b.url,
        createdAt: b.createdAt,
        coordinate:
          candidate?.latitude != null && candidate.longitude != null
            ? { latitude: candidate.latitude, longitude: candidate.longitude }
            : null,
      };
    }),
    place,
    postingId: postingIdFor('auto', config.publisher_id, now),
    now,
  });
  await stamp();
  return `posted ${result.photoCount} to ${result.subscriberCount} subscribers`;
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

  // Kept as one literal (not a shared const): supabase-js infers the row type
  // from the column string, and a computed one degrades it to GenericStringError.
  const { data: configs, error } = await supabase
    .from('publisher_config')
    .select(
      'publisher_id, require_approval, photos_per_post, notify_day_of_week, notify_time, enabled_categories, lookback_days, min_quality, timezone, expo_push_token, last_auto_post_at, post_pending_since, last_wake_push_at, last_candidate_sync_at, photo_sync_state',
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
