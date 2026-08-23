/**
 * Supabase Edge Function: POST /post-batch  { "batchId": "…" }
 *
 * The server half of the background "Post now" action. Pressing "Post now" on
 * an approval push used to launch the app, re-scan the library and upload from
 * the device; the batch's photos are already in the cloud, so the phone now
 * just calls this — from a background launch, without ever coming to the
 * foreground — and the fan-out happens here. When it lands we push the
 * publisher a "Posted ✅" notification that deep links to the new posting.
 *
 * Auth: the publisher's own JWT. A batch can only be posted by the publisher it
 * belongs to.
 *
 * Idempotent: the row is claimed with a conditional update on `posted_at`, so a
 * redelivered notification response (or the app replaying an unhandled one on
 * next launch) returns the original posting instead of sending twice.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
 *      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM.
 * Optional: TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET (preferred auth),
 *      TWILIO_STATUS_CALLBACK_URL (delivery tracking via twilio-status).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { postingIdFor, publishBatch, twilioFromEnv, type PublishablePhoto } from '../_shared/publishBatch.ts';
import { resolveBatchPlace } from '../_shared/geocode.ts';
import { isTokenDead, sendExpoPush } from '../_shared/expoPush.ts';
import type { Coordinate } from '../../../src/domain/services/postingLocation.ts';
import { postedPushContent, postFailedPushContent, publishablePhotos } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TWILIO = twilioFromEnv();

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function authenticatedUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (token === '') return null;
  try {
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** The publisher's Expo push token, or '' when they never registered one. */
async function pushTokenFor(publisherId: string): Promise<string> {
  const { data } = await admin
    .from('publisher_config')
    .select('expo_push_token')
    .eq('publisher_id', publisherId)
    .maybeSingle();
  return (data as { expo_push_token: string | null } | null)?.expo_push_token ?? '';
}

/**
 * Notify the publisher. Best-effort: the post itself already went out, and a
 * failed confirmation must not turn a successful publish into a 500 (which the
 * app would retry — and the retry would be a no-op, but the publisher would
 * still be left without confirmation).
 */
async function pushToPublisher(
  publisherId: string,
  token: string,
  content: { title: string; body: string },
  data: Record<string, unknown>,
): Promise<void> {
  if (!token) return;
  // sendExpoPush reads the ticket, so "best-effort" now means we know when the
  // effort failed. Expo reports a dead token inside an HTTP 200, which the bare
  // fetch here could never have seen — see _shared/expoPush.ts.
  const failure = await sendExpoPush({ to: token, ...content, sound: 'default', data });
  if (failure == null) return;

  console.error(
    `post-batch confirmation push failed for ${publisherId}: ${failure.code ?? 'no code'} — ${failure.message}`,
  );
  if (isTokenDead(failure)) {
    console.warn(`clearing dead push token for ${publisherId}`);
    await admin
      .from('publisher_config')
      .update({ expo_push_token: null })
      .eq('publisher_id', publisherId);
  }
}

/** GPS for the batch's assets, read back from the candidate rows that carry it. */
async function coordinatesFor(
  publisherId: string,
  assetIds: string[],
): Promise<Map<string, Coordinate>> {
  const { data } = await admin
    .from('candidate_photos')
    .select('asset_id, latitude, longitude')
    .eq('publisher_id', publisherId)
    .in('asset_id', assetIds);
  const rows = (data ?? []) as { asset_id: string; latitude: number | null; longitude: number | null }[];
  const map = new Map<string, Coordinate>();
  for (const row of rows) {
    if (row.latitude != null && row.longitude != null) {
      map.set(row.asset_id, { latitude: row.latitude, longitude: row.longitude });
    }
  }
  return map;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const userId = await authenticatedUserId(req);
  if (userId == null) return json({ error: 'Authentication required' }, 401);

  let batchId: unknown;
  try {
    ({ batchId } = (await req.json()) as { batchId?: unknown });
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof batchId !== 'string' || batchId === '') return json({ error: 'batchId is required' }, 400);

  const { data: row, error: readError } = await admin
    .from('approval_batches')
    .select('publisher_id, batch, posted_at, posting_id')
    .eq('batch_id', batchId)
    .maybeSingle();
  if (readError != null) return json({ error: readError.message }, 500);
  if (row == null) return json({ error: 'Batch not found' }, 404);

  const batchRow = row as {
    publisher_id: string;
    batch: unknown;
    posted_at: string | null;
    posting_id: string | null;
  };
  // Not "forbidden" with detail — a batch belonging to someone else is
  // indistinguishable from one that does not exist, from the caller's side.
  if (batchRow.publisher_id !== userId) return json({ error: 'Batch not found' }, 404);

  if (batchRow.posted_at != null) {
    return json({ alreadyPosted: true, postingId: batchRow.posting_id });
  }

  const photos = publishablePhotos(batchRow.batch);
  if (photos.length === 0) return json({ error: 'Batch has no publishable photos' }, 422);

  const now = new Date();
  const postingId = postingIdFor('now', userId, now);

  // Claim the batch BEFORE sending. Two concurrent calls (a background launch
  // and a foreground replay of the same response) both read posted_at as null
  // above; only the one whose conditional update matches a row goes on to send.
  const { data: claimed, error: claimError } = await admin
    .from('approval_batches')
    .update({ posted_at: now.toISOString(), posting_id: postingId })
    .eq('batch_id', batchId)
    .is('posted_at', null)
    .select('batch_id');
  if (claimError != null) return json({ error: claimError.message }, 500);
  if ((claimed ?? []).length === 0) {
    const { data: winner } = await admin
      .from('approval_batches')
      .select('posting_id')
      .eq('batch_id', batchId)
      .maybeSingle();
    return json({ alreadyPosted: true, postingId: (winner as { posting_id: string | null } | null)?.posting_id ?? null });
  }

  const token = await pushTokenFor(userId);

  try {
    const coordinates = await coordinatesFor(userId, photos.map(p => p.id));
    // Name the batch's place from the photos' GPS (issue #23) — null when none
    // were geotagged; the message then omits the location clause.
    const place = await resolveBatchPlace([...coordinates.values()]);

    const publishable: PublishablePhoto[] = photos.map(p => ({
      id: p.id,
      url: p.url,
      createdAt: p.createdAt,
      coordinate: coordinates.get(p.id) ?? null,
    }));

    const result = await publishBatch(admin, TWILIO, {
      publisherId: userId,
      photos: publishable,
      place,
      postingId,
      now,
    });

    await pushToPublisher(
      userId,
      token,
      postedPushContent(result.photoCount, result.subscriberCount, place),
      { screen: 'Posting', postingId, publisherId: userId },
    );

    return json({ ...result, place });
  } catch (err) {
    // Release the claim so the publisher (or a retry) can post this batch after
    // a transient failure — a latched row would be permanently unpostable.
    await admin
      .from('approval_batches')
      .update({ posted_at: null, posting_id: null })
      .eq('batch_id', batchId);
    console.error(`post-batch ${batchId} failed:`, err);
    await pushToPublisher(userId, token, postFailedPushContent(), {
      screen: 'ReviewSuggestion',
      publisherId: userId,
      batchId,
    });
    return json({ error: err instanceof Error ? err.message : 'Publish failed' }, 500);
  }
});
