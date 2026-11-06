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
import { publicIdFromUrl } from '../delete-candidates/logic.ts';
import { type AdminDb, runAccountDeletion } from '../../../src/infrastructure/server/accountDeletion.ts';

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

  try {
    const result = await runAccountDeletion(admin as unknown as AdminDb, userId, {
      publicIdFromUrl,
      destroyAsset: CLOUDINARY != null ? (id) => destroyCloudinaryAsset(CLOUDINARY, id) : null,
    });
    console.log(`delete-account: user ${userId} deleted — ${result.assetsDeleted}/${result.assetsFound} assets destroyed`);
    return json({ deleted: true, ...result, cloudinaryConfigured: CLOUDINARY != null });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
