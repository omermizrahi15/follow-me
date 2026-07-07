/**
 * Supabase Edge Function: POST /delete-candidates
 *
 * "Delete my uploaded photos": wipes the calling user's candidate_photos rows
 * and best-effort deletes the Cloudinary assets behind them. Auth: requires
 * the signed-in user's JWT — the user can only wipe their own photos.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected).
 * Optional (for Cloudinary asset deletion): CLOUDINARY_CLOUD_NAME,
 * CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET — without them only the DB rows
 * are removed and the orphaned assets age out via Cloudinary's own tooling.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLOUDINARY_CLOUD = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? '';
const CLOUDINARY_KEY = Deno.env.get('CLOUDINARY_API_KEY') ?? '';
const CLOUDINARY_SECRET = Deno.env.get('CLOUDINARY_API_SECRET') ?? '';

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

function publicIdFromUrl(url: string): string | null {
  const m = url.match(/\/image\/upload\/(?:[^/]+\/)*?v\d+\/(.+?)(\.[A-Za-z0-9]+)?$/);
  return m?.[1] ?? null;
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Signed Cloudinary destroy — returns true when the asset was deleted. */
async function destroyCloudinaryAsset(publicId: string): Promise<boolean> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sha1Hex(`public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_SECRET}`);
  const form = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: CLOUDINARY_KEY,
    signature,
  });
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { result?: string };
  return data.result === 'ok' || data.result === 'not found';
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const userId = await authenticatedUserId(req);
  if (userId == null) return json({ error: 'Authentication required' }, 401);

  const { data: rows, error: selectError } = await admin
    .from('candidate_photos')
    .select('url')
    .eq('publisher_id', userId);
  if (selectError != null) return json({ error: selectError.message }, 500);

  const { error: deleteError } = await admin
    .from('candidate_photos')
    .delete()
    .eq('publisher_id', userId);
  if (deleteError != null) return json({ error: deleteError.message }, 500);

  // Best-effort asset cleanup — DB rows are already gone either way.
  let assetsDeleted = 0;
  const cloudinaryConfigured = CLOUDINARY_CLOUD !== '' && CLOUDINARY_KEY !== '' && CLOUDINARY_SECRET !== '';
  if (cloudinaryConfigured) {
    for (const row of (rows ?? []) as { url: string }[]) {
      const publicId = publicIdFromUrl(row.url);
      if (publicId == null) continue;
      try {
        if (await destroyCloudinaryAsset(publicId)) assetsDeleted++;
      } catch (err) {
        console.error(`cloudinary destroy failed for ${publicId}:`, err);
      }
    }
  }

  console.log(`delete-candidates: user ${userId} — ${rows?.length ?? 0} rows, ${assetsDeleted} assets deleted (cloudinary ${cloudinaryConfigured ? 'on' : 'off'})`);
  return json({ deletedRows: rows?.length ?? 0, deletedAssets: assetsDeleted, cloudinaryConfigured });
});
