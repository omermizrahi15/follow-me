// Records a sent batch as a `posts` row and returns the public gallery URL —
// a static page on GitHub Pages (docs/gallery.html) that reads the row via
// Supabase REST. Hosted there because Supabase serves Edge Function and
// Storage HTML as text/plain (anti-phishing), so it can't host pages itself
// (same constraint that made /join a redirect).

const DEFAULT_GALLERY_BASE_URL = 'https://omermizrahi15.github.io/follow-me/gallery.html';

/**
 * Override with the GALLERY_BASE_URL secret (e.g. after moving to a custom
 * domain). Read per call rather than at module load: the pre-commit and CI
 * gates run `deno test` without --allow-env, and a top-level Deno.env.get
 * throws on import — before any test can grant permission.
 */
function galleryBaseUrl(): string {
  try {
    return Deno.env.get('GALLERY_BASE_URL') ?? DEFAULT_GALLERY_BASE_URL;
  } catch {
    // Reading it is what needs the permission, so the catch is the unit-test
    // path, not an error case — the default is what production uses anyway.
    return DEFAULT_GALLERY_BASE_URL;
  }
}

/**
 * The publisher's feed on the gallery page — every post they have shared,
 * newest first (`?u=`), as opposed to the single-post story `?id=` links that
 * `savePostGallery` returns. Used by the new-follower welcome, which has no
 * one post to point at.
 *
 * Pure string building, so unlike `savePostGallery` it cannot fail and needs
 * no null branch at the call site.
 */
export function publisherGalleryUrl(publisherId: string): string {
  return `${galleryBaseUrl()}?u=${encodeURIComponent(publisherId)}`;
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function postId(publisherId: string, mediaUrls: string[]): Promise<string> {
  const data = new TextEncoder().encode(`${publisherId}|${mediaUrls.join('|')}`);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(digest)]
    .slice(0, 10)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Records the post row that the gallery page reads, and returns the public
 * gallery URL — or null on failure, because the link is an enhancement and
 * must never block the send. The id is a deterministic hash of publisher +
 * urls, so per-subscriber calls (or retries) upsert the same row instead of
 * duplicating it.
 *
 * `place` is stored so the gallery's post list can label each card the way the
 * app's feed does; it is the same label the message names, and null when the
 * batch had no location.
 *
 * `postingId` is the batch id the same send stamps on its `media` rows. It is
 * what lets the publisher deleting a post hide it from followers: without it
 * the two tables share no key, and trashed posts stayed visible in the gallery.
 *
 * `coordinate` is where the batch was taken: it places the post on the globe
 * the gallery shows followers, rounded to ~11 km first because the row is
 * public. When the caller has none it is looked up from the posting's media rows.
 */
export async function savePostGallery(
  supabase: SupabaseClient,
  publisherId: string,
  mediaUrls: string[],
  place: string | null = null,
  postingId: string | null = null,
  coordinate: { latitude: number; longitude: number } | null = null,
): Promise<string | null> {
  try {
    const id = await postId(publisherId, mediaUrls);
    const exact = coordinate ?? (postingId != null ? await postingCoordinate(supabase, publisherId, postingId) : null);
    const where = exact != null ? blurCoordinate(exact) : null;
    const row = { id, publisher_id: publisherId, media_urls: mediaUrls, place };
    // Each column the environment might not have yet is dropped in turn rather
    // than failing the upsert: a missing column must cost a feature (an
    // untrashable post, a post off the follower globe), never the link.
    const attempts: Record<string, unknown>[] = [];
    const withPosting = postingId != null ? { ...row, posting_id: postingId } : row;
    if (where != null) attempts.push({ ...withPosting, latitude: where.latitude, longitude: where.longitude });
    attempts.push(withPosting);
    if (postingId != null) attempts.push(row);

    let error: { message: string } | null = null;
    for (const attempt of attempts) {
      ({ error } = await supabase.from('posts').upsert(attempt));
      if (error == null) break;
    }
    if (error != null) throw new Error(error.message);
    return `${galleryBaseUrl()}?id=${id}`;
  } catch (err) {
    console.error('savePostGallery failed:', err);
    return null;
  }
}

/**
 * Rounds to one decimal place (~11 km). `posts` is readable by anyone holding
 * the public anon key, so the exact fix the photo's GPS recorded — possibly the
 * publisher's home — must never be stored there. A marker on a globe, next to a
 * city-level place label, needs nothing finer.
 */
function blurCoordinate(c: { latitude: number; longitude: number }): { latitude: number; longitude: number } {
  const blur = (n: number): number => Math.round(n * 10) / 10;
  return { latitude: blur(c.latitude), longitude: blur(c.longitude) };
}

/**
 * Where a posting was taken, from the `media` rows stamped with its id — for
 * callers (send-post) that are handed a posting id but no coordinate. Null on
 * any miss or error: the globe is an enhancement and must not block the send.
 */
async function postingCoordinate(
  supabase: SupabaseClient,
  publisherId: string,
  postingId: string,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const { data } = await supabase
      .from('media')
      .select('latitude, longitude')
      .eq('owner_id', publisherId)
      .eq('posting_id', postingId)
      .not('latitude', 'is', null)
      .limit(1);
    const row = (data ?? [])[0] as { latitude: number | null; longitude: number | null } | undefined;
    return row?.latitude != null && row.longitude != null
      ? { latitude: row.latitude, longitude: row.longitude }
      : null;
  } catch {
    return null;
  }
}
