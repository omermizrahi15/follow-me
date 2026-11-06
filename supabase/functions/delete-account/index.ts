/**
 * Supabase Edge Function: POST /delete-account
 *
 * Permanently deletes the calling user's account and everything tied to it
 * (App Store guideline 5.1.1(v): deletion must be possible inside the app).
 * Auth: the signed-in user's JWT — a user can only delete themselves.
 *
 * Order matters for retries: asset ids are read first, rows are wiped, Cloudinary
 * assets are destroyed best-effort, and the auth user goes LAST. If any earlier
 * step fails the user still exists and can simply try again; every step is
 * idempotent.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected). Optional
 * Cloudinary credentials, as for delete-candidates.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cloudinaryCredsFromEnv, destroyCloudinaryAsset } from '../_shared/cloudinary.ts';
import { cloudinaryIdsToDestroy, USER_DATA_TABLES } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLOUDINARY = cloudinaryCredsFromEnv(Deno.env);

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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const userId = await authenticatedUserId(req);
  if (userId == null) return json({ error: 'Authentication required' }, 401);

  // 1. Remember which Cloudinary assets are theirs before the rows disappear.
  const [media, candidates, posts, avatars] = await Promise.all([
    admin.from('media').select('url').eq('owner_id', userId),
    admin.from('candidate_photos').select('url').eq('publisher_id', userId),
    admin.from('posts').select('media_urls').eq('publisher_id', userId),
    admin.from('publisher_profile').select('avatar_url').eq('publisher_id', userId),
  ]);
  const readError = [media, candidates, posts, avatars].find((r) => r.error != null)?.error;
  if (readError != null) return json({ error: readError.message }, 500);
  const assetIds = cloudinaryIdsToDestroy({
    media: media.data ?? [],
    candidates: candidates.data ?? [],
    posts: posts.data ?? [],
    avatars: avatars.data ?? [],
  });

  // 2. Wipe every table.
  for (const { table, column } of USER_DATA_TABLES) {
    const { error } = await admin.from(table).delete().eq(column, userId);
    if (error != null) return json({ error: `${table}: ${error.message}` }, 500);
  }

  // 3. Best-effort asset cleanup; the rows are gone either way.
  let assetsDeleted = 0;
  if (CLOUDINARY != null) {
    for (const id of assetIds) {
      try {
        if (await destroyCloudinaryAsset(CLOUDINARY, id)) assetsDeleted++;
      } catch (err) {
        console.error(`cloudinary destroy failed for ${id}:`, err);
      }
    }
  }

  // 4. The account itself, last.
  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError != null) return json({ error: authError.message }, 500);

  console.log(`delete-account: user ${userId} deleted — ${assetsDeleted}/${assetIds.length} assets destroyed`);
  return json({ deleted: true, assetsDeleted, assetsFound: assetIds.length, cloudinaryConfigured: CLOUDINARY != null });
});
