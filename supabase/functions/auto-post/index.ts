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
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { selectBatch, type SharedClassification } from '../_shared/photoSelection.ts';
import { isAutoPostDue } from '../_shared/autoPostSchedule.ts';
import { sendBatch, type TwilioCreds } from '../_shared/twilio.ts';
import { composeAutoPostBody } from '../_shared/notificationBody.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const TWILIO: TwilioCreds = {
  accountSid: Deno.env.get('TWILIO_ACCOUNT_SID') ?? '',
  authToken: Deno.env.get('TWILIO_AUTH_TOKEN') ?? '',
  fromNumber: Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '',
};
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

async function pushReminder(token: string): Promise<void> {
  if (!token) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'Ready for your next post?',
      body: "We couldn't auto-pick photos this time — tap to choose some.",
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

/** Send a rich Expo push notification with the pre-computed batch embedded in the payload. */
async function pushApprovalBatch(
  token: string,
  publisherId: string,
  batch: BatchPhoto[],
  pool: BatchPhoto[],
): Promise<void> {
  if (!token) return;

  const batchId = crypto.randomUUID();

  // Build a readable summary from captions (e.g. "Sunset · Street food · Mountain view").
  const preview = batch
    .slice(0, 3)
    .map(p => p.caption)
    .filter(Boolean)
    .join(' · ');

  const title = `${batch.length} photo${batch.length !== 1 ? 's' : ''} ready to post 📸`;
  const body = preview.length > 0 ? preview : "Your AI-selected photos are ready to review.";

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
        batch,
        pool,
        imageUrl: batch[0]?.url ?? null,
      },
    }),
  });
}

/** Process a publisher who requires approval: compute the batch and send a rich push. */
async function processApprovalPublisher(config: ConfigRow, now: Date): Promise<string> {
  const [hour, minute] = config.notify_time.split(':').map(Number);
  const due = isAutoPostDue(
    {
      dayOfWeek: config.notify_day_of_week,
      hour: hour ?? 0,
      minute: minute ?? 0,
      timezone: config.timezone,
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
    .select('asset_id, url, created_at')
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
    await pushReminder(token);
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
    await pushReminder(token);
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

  await pushApprovalBatch(token, config.publisher_id, batchPayload, poolPayload);
  await stamp();
  return `pushed ${selectedBatch.length} photos (${poolPayload.length} in pool)`;
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

async function processAutoPublisher(config: ConfigRow, now: Date): Promise<string> {
  const [hour, minute] = config.notify_time.split(':').map(Number);
  const due = isAutoPostDue(
    {
      dayOfWeek: config.notify_day_of_week,
      hour: hour ?? 0,
      minute: minute ?? 0,
      timezone: config.timezone,
      lastAutoPostAt: config.last_auto_post_at != null ? new Date(config.last_auto_post_at) : null,
    },
    now,
  );
  if (!due) return 'not-due';

  const cutoff = new Date(now.getTime() - config.lookback_days * MS_PER_DAY).toISOString();
  const { data: candidates } = await supabase
    .from('candidate_photos')
    .select('asset_id, url, created_at')
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
    await pushReminder(config.expo_push_token ?? '');
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
    await pushReminder(config.expo_push_token ?? '');
    await stamp();
    return 'reminder (empty batch)';
  }

  const { name, phone } = await publisherIdentity(config.publisher_id);
  const caption = composeAutoPostBody(name, phone);
  const urls = batch.map(b => b.url);

  const { data: subs } = await supabase
    .from('subscribers')
    .select('contact_handle')
    .eq('publisher_id', config.publisher_id)
    .eq('status', 'active');

  for (const sub of (subs ?? []) as { contact_handle: string }[]) {
    const result = await sendBatch(TWILIO, sub.contact_handle, caption, urls);
    if (result.failed > 0) {
      console.error(`auto-post to ${sub.contact_handle}: ${result.failed}/${urls.length} sends failed:`, result.errors);
    }
  }

  await supabase.from('media').upsert(
    batch.map(b => ({
      id: b.assetId,
      owner_id: config.publisher_id,
      url: b.url,
      created_at: new Date(b.createdAt).toISOString(),
    })),
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
