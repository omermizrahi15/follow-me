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
import {
  selectBatch,
  type PhotoFacts,
  type PhotosOfMeMode,
} from '../../../src/domain/services/photoSelection.ts';
import { isAutoPostDue } from '../../../src/domain/services/autoPostSchedule.ts';
import { credsFromEnv } from '../../../src/infrastructure/notifiers/twilioClient.ts';
import { postingIdFor, publishBatch } from '../_shared/publishBatch.ts';
import { galleryUrls, saveApprovalBatch } from '../_shared/approvalBatch.ts';
import { resolveBatchPlace } from '../_shared/geocode.ts';
import type { Coordinate } from '../../../src/domain/services/postingLocation.ts';
import { isTokenDead, sendExpoPush } from '../_shared/expoPush.ts';
import {
  approvalPushContent,
  chunk,
  GRADE_BUDGET_PER_TICK,
  gradingDecision,
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
  /** "photos of me" preference — see PublisherConfig.photosOfMe (issue #137). */
  photos_of_me: string | null;
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

/** Same narrowing for the face preference; anything unrecognised is 'off'. */
function parsePhotosOfMe(value: string | null): PhotosOfMeMode {
  return value === 'prefer' || value === 'only' ? value : 'off';
}

/**
 * The publisher's profile photo, when their preference asks for it (issue #137).
 *
 * Read per due publisher rather than joined into the config query: this runs on
 * a cron tick over everyone due, and only publishers who turned the preference
 * on cost a lookup. Null — no avatar, or the preference off — means classify is
 * never shown a face, exactly as on the device.
 */
async function faceReference(config: ConfigRow): Promise<{ url: string } | null> {
  if (parsePhotosOfMe(config.photos_of_me) === 'off') return null;
  const { data } = await supabase
    .from('publisher_profile')
    .select('avatar_url')
    .eq('publisher_id', config.publisher_id)
    .maybeSingle();
  const url = (data as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  return url != null && url !== '' ? { url } : null;
}

/**
 * The face preference the selection rules should actually run under.
 *
 * `off` whenever no reference was resolved, even though the column says
 * otherwise. Without a face every photo reads "not known to contain the
 * publisher", so `only` would filter the entire window away — and on this path
 * that is not a short post the publisher can see and fix, it is an autonomous
 * posting slot silently spent on a "nothing to post" reminder. Mirrors
 * SuggestPhotosUseCase.selectionConfig on the device.
 */
function effectivePhotosOfMe(config: ConfigRow, reference: { url: string } | null): PhotosOfMeMode {
  return reference == null ? 'off' : parsePhotosOfMe(config.photos_of_me);
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
  // Cached grade (migration 20240035). `graded_at == null` means "not yet
  // classified" — the work queue this job drains a slice of per tick.
  category: string | null;
  confidence: number | null;
  quality: number | null;
  caption: string | null;
  scene: string | null;
  graded_at: string | null;
}

/** Columns every candidate read needs: the photo, its GPS, and its cached grade. */
const CANDIDATE_COLUMNS =
  'asset_id, url, created_at, latitude, longitude, category, confidence, quality, caption, scene, graded_at';

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
  /** Absent unless the request carried a reference face — see issue #137. */
  contains_reference_person?: boolean;
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
  containsPublisher: boolean;
}

/** How this shape answers the selection rules' questions (see photoSelection). */
const selectionFacts = (c: ClassifiedCandidate): PhotoFacts => ({
  id: c.assetId,
  category: c.category,
  quality: c.quality,
  createdAt: c.createdAt,
  scene: c.scene,
  containsPublisher: c.containsPublisher,
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
      containsPublisher: c.contains_reference_person === true,
    });
  }
  return joined;
}

/**
 * Photos per classify-photos request. Must stay at or below that function's own
 * MAX_PHOTOS_PER_REQUEST, which answers 400 above it.
 *
 * Set to the function's own cap, because a request is now a single Gemini call
 * carrying every photo in it. When each photo cost its own call this was 1, to
 * make a rate-limited refusal cost only the photo it refused; batching inverts
 * that reasoning entirely — asking for one photo at a time would spend twelve
 * rate-limit slots to do one request's work.
 */
const CLASSIFY_PHOTOS_PER_REQUEST = 12;

/**
 * Requests in flight at once.
 *
 * This was 3, which combined with 3 photos per request put 9 Gemini calls in
 * the air per wave — against a free tier that allows 5 per MINUTE. Every run
 * 429'd on its first wave. Concurrency of 1 is not a throughput loss here: the
 * upstream rate limit was always the binding constraint, and parallelism only
 * decided how fast we reached it. Worse, it decided how much work was in flight
 * when the wall was hit, and everything in flight was lost. Progress now comes
 * from the grade cache (migration 20240035) instead of from firing more
 * requests at a closed door.
 */
const CLASSIFY_CONCURRENCY = 1;

/** The cached grade for a candidate, or null when it hasn't been classified yet. */
function cachedGrade(row: CandidateRow): RawClassification | null {
  if (row.graded_at == null || row.category == null) return null;
  return {
    id: row.asset_id,
    category: row.category,
    confidence: row.confidence ?? 0,
    quality: row.quality ?? 0,
    caption: row.caption ?? '',
    scene: row.scene ?? '',
  };
}

/**
 * Grades one chunk, or returns null if the request was refused.
 *
 * Returning null rather than throwing is the whole point. A 429 here used to
 * reject a Promise.all, which unwound the entire publisher's run — past the
 * reminder fallback, past the schedule stamp — so a transient upstream rate
 * limit became permanent silence. A refused chunk is now just work that didn't
 * happen this tick.
 */
async function classifyChunk(
  publisherId: string,
  photos: { id: string; url: string }[],
  reference: { url: string } | null,
): Promise<RawClassification[] | null> {
  let res: Response;
  try {
    res = await fetch(CLASSIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_KEY}`,
        // No user session on a cron tick — the service-role key authenticates the
        // call and this names whose daily quota it spends. See the classify-photos
        // authenticatedUserId comment.
        'x-publisher-id': publisherId,
      },
      body: JSON.stringify(reference == null ? { photos } : { photos, reference }),
    });
  } catch (err) {
    console.warn(`classify-photos unreachable for ${publisherId}:`, err);
    return null;
  }

  if (!res.ok) {
    // classify-photos distinguishes its own daily ceiling from Gemini's
    // per-minute one and says which in `reason`; both mean "not now", and the
    // log line is what makes the difference visible without a debugging session.
    const detail = await res.text().catch(() => '');
    console.warn(`classify-photos refused (${res.status}) for ${publisherId}: ${detail.slice(0, 300)}`);
    return null;
  }

  const body = (await res.json()) as { classifications?: RawClassification[] };
  return body.classifications ?? [];
}

/** Persist freshly bought grades so no tick ever pays for the same photo twice. */
async function cacheGrades(
  publisherId: string,
  grades: RawClassification[],
  now: Date,
): Promise<void> {
  const gradedAt = now.toISOString();
  const writes = grades.map(g =>
    supabase
      .from('candidate_photos')
      .update({
        category: g.category,
        confidence: g.confidence,
        quality: g.quality,
        caption: g.caption,
        scene: g.scene,
        graded_at: gradedAt,
      })
      .eq('publisher_id', publisherId)
      .eq('asset_id', g.id),
  );
  const results = await Promise.all(writes);
  for (const { error } of results) {
    // Best-effort: a cache write that fails costs a re-grade later, which is
    // strictly better than losing the batch we already paid for.
    if (error != null) console.error('grade cache write failed:', error.message);
  }
}

interface Grading {
  /** Every grade available for selection — cached plus whatever this tick bought. */
  classified: RawClassification[];
  /** Candidates in the window still without a grade after this tick. */
  ungraded: number;
}

/**
 * Returns the window's grades, buying at most GRADE_BUDGET_PER_TICK new ones.
 *
 * Newest-first, because a partially graded window that has to be posted from
 * still wants the most recent photos in it — the same ordering the device-side
 * grading settled on in PR #122.
 */
async function gradeCandidates(
  publisherId: string,
  rows: CandidateRow[],
  now: Date,
  reference: { url: string } | null,
): Promise<Grading> {
  const classified: RawClassification[] = [];
  const ungraded: CandidateRow[] = [];
  for (const row of rows) {
    const grade = cachedGrade(row);
    if (grade != null) classified.push(grade);
    else ungraded.push(row);
  }

  const queue = [...ungraded]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, GRADE_BUDGET_PER_TICK);

  const fresh: RawClassification[] = [];
  const chunks = chunk(
    queue.map(r => ({ id: r.asset_id, url: r.url })),
    CLASSIFY_PHOTOS_PER_REQUEST,
  );
  for (let i = 0; i < chunks.length; i += CLASSIFY_CONCURRENCY) {
    const wave = await Promise.all(
      chunks
        .slice(i, i + CLASSIFY_CONCURRENCY)
        .map(group => classifyChunk(publisherId, group, reference)),
    );
    // A refusal is the rate limit talking. Stop asking this tick — the next
    // chunk would only collect another 429 and burn worker time doing it.
    if (wave.some(part => part == null)) {
      for (const part of wave) if (part != null) fresh.push(...part);
      break;
    }
    for (const part of wave) fresh.push(...(part ?? []));
  }

  if (fresh.length > 0) await cacheGrades(publisherId, fresh, now);
  classified.push(...fresh);

  return { classified, ungraded: ungraded.length - fresh.length };
}

/**
 * Sends one push and acts on what Expo says came of it.
 *
 * Expo answers HTTP 200 for a delivered notification and for one it dropped
 * because the token is dead, so the ticket is the only place the truth lives —
 * see _shared/expoPush.ts. A token Expo calls permanently unregistered is
 * cleared here, which also releases any pending slot being held for a publisher
 * nothing can reach.
 */
async function deliver(
  publisherId: string,
  token: string,
  message: Record<string, unknown>,
  label: string,
): Promise<boolean> {
  if (!token) return false;
  const failure = await sendExpoPush({ to: token, ...message });
  if (failure == null) return true;

  console.error(`${label} push failed for ${publisherId}: ${failure.code ?? 'no code'} — ${failure.message}`);
  if (isTokenDead(failure)) {
    console.warn(`clearing dead push token for ${publisherId}`);
    await updateConfig(publisherId, { expo_push_token: null });
  }
  return false;
}

async function pushReminder(
  publisherId: string,
  token: string,
  reason: ReminderReason,
): Promise<void> {
  const { title, body } = reminderPushContent(reason);
  await deliver(publisherId, token, { title, body, data: { screen: 'ReviewSuggestion' } }, 'reminder');
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
async function pushSyncWake(publisherId: string, token: string): Promise<void> {
  await deliver(
    publisherId,
    token,
    { data: { type: 'sync-candidates' }, _contentAvailable: true, priority: 'normal' },
    'sync-wake',
  );
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
    await pushReminder(config.publisher_id, token, decision.reason);
    await stamp();
    return `reminder (${decision.reason})`;
  }

  if (decision.nudge) await pushSyncWake(config.publisher_id, token);
  await updateConfig(config.publisher_id, {
    // Keep the original timestamp so the grace window measures from first sight.
    post_pending_since: config.post_pending_since ?? now.toISOString(),
    ...(decision.nudge ? { last_wake_push_at: now.toISOString() } : {}),
  });
  return decision.nudge ? 'waiting for sync (device woken)' : 'waiting for sync';
}

/**
 * A posting came due, the photos are here, but they aren't all graded yet.
 *
 * Same slot-holding mechanism as holdForSync and for the same reason — the
 * schedule is not stamped, so `post_pending_since` keeps this publisher in play
 * on later ticks until the batch can actually be built. What's deliberately
 * absent is the wake push: the phone has done its part, the backlog is ours,
 * and spending iOS background-push budget to tell a device about our own rate
 * limit would achieve nothing.
 */
async function holdForGrading(config: ConfigRow, now: Date, remaining: number): Promise<string> {
  await updateConfig(config.publisher_id, {
    post_pending_since: config.post_pending_since ?? now.toISOString(),
  });
  return `grading (${remaining} photos left)`;
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

  await deliver(
    publisherId,
    token,
    {
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
    },
    'approval-batch',
  );
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
    .select(CANDIDATE_COLUMNS)
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

  const reference = await faceReference(config);
  const grading = await gradeCandidates(config.publisher_id, rows, now, reference);
  const gradeDecision = gradingDecision({
    gradedCount: grading.classified.length,
    ungradedCount: grading.ungraded,
    pendingSince: parseDate(config.post_pending_since),
    now,
  });
  if (gradeDecision.kind === 'wait') return holdForGrading(config, now, grading.ungraded);
  if (gradeDecision.kind === 'give-up') {
    await pushReminder(config.publisher_id, token, gradeDecision.reason);
    await stamp();
    return `reminder (${gradeDecision.reason})`;
  }

  const classified = grading.classified;
  const classifiedRows = classifiedCandidates(classified, rows);

  const selectedBatch = selectBatch(
    classifiedRows,
    selectionFacts,
    {
      enabledCategories: config.enabled_categories,
      photosPerPost: config.photos_per_post,
      // The publisher's quality floor. Passed here too so the autonomous post
      // and the one they'd have built by hand agree — the column has existed
      // all along and neither runtime was reading it.
      minQuality: config.min_quality,
      photosOfMe: effectivePhotosOfMe(config, reference),
    },
    alreadySent,
  );

  // No grace window here, unlike the empty-cloud-set case: the photos ARE
  // synced and graded, they just don't pass the publisher's filters. Waiting
  // would re-reach the same verdict every tick, so say so now. (Photos still
  // waiting on a grade never get here — gradingDecision holds the slot first.)
  if (selectedBatch.length === 0) {
    await pushReminder(config.publisher_id, token, 'empty-batch');
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
    .select(CANDIDATE_COLUMNS)
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

  const reference = await faceReference(config);
  const grading = await gradeCandidates(config.publisher_id, rows, now, reference);
  const gradeDecision = gradingDecision({
    gradedCount: grading.classified.length,
    ungradedCount: grading.ungraded,
    pendingSince: parseDate(config.post_pending_since),
    now,
  });
  if (gradeDecision.kind === 'wait') return holdForGrading(config, now, grading.ungraded);
  if (gradeDecision.kind === 'give-up') {
    await pushReminder(config.publisher_id, config.expo_push_token ?? '', gradeDecision.reason);
    await stamp();
    return `reminder (${gradeDecision.reason})`;
  }

  const batch = selectBatch(
    classifiedCandidates(grading.classified, rows),
    selectionFacts,
    {
      enabledCategories: config.enabled_categories,
      photosPerPost: config.photos_per_post,
      // The publisher's quality floor. Passed here too so the autonomous post
      // and the one they'd have built by hand agree — the column has existed
      // all along and neither runtime was reading it.
      minQuality: config.min_quality,
      photosOfMe: effectivePhotosOfMe(config, reference),
    },
    alreadySent,
  );

  // Synced but unusable — see the same branch in processApprovalPublisher for
  // why this one doesn't get a grace window.
  if (batch.length === 0) {
    await pushReminder(config.publisher_id, config.expo_push_token ?? '', 'empty-batch');
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
      'publisher_id, require_approval, photos_per_post, notify_day_of_week, notify_time, enabled_categories, lookback_days, min_quality, timezone, expo_push_token, photos_of_me, last_auto_post_at, post_pending_since, last_wake_push_at, last_candidate_sync_at, photo_sync_state',
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
