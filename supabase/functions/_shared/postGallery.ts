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
 */
export async function savePostGallery(
  supabase: SupabaseClient,
  publisherId: string,
  mediaUrls: string[],
  place: string | null = null,
  postingId: string | null = null,
): Promise<string | null> {
  try {
    const id = await postId(publisherId, mediaUrls);
    const row = { id, publisher_id: publisherId, media_urls: mediaUrls, place };
    let { error } = await supabase
      .from('posts')
      .upsert(postingId != null ? { ...row, posting_id: postingId } : row);
    // `posting_id` arrives with migration 20240032. Against an environment the
    // migration hasn't reached, naming the column 400s the upsert and every
    // message loses its gallery link — so fall back to the row without it. The
    // post is then untrashable until the migration runs, which beats sending
    // linkless messages in the meantime.
    if (error != null && postingId != null) {
      ({ error } = await supabase.from('posts').upsert(row));
    }
    if (error != null) throw new Error(error.message);
    return `${galleryBaseUrl()}?id=${id}`;
  } catch (err) {
    console.error('savePostGallery failed:', err);
    return null;
  }
}
