// Records a sent batch as a `posts` row and returns the public gallery URL —
// a static page on GitHub Pages (docs/gallery.html) that reads the row via
// Supabase REST. Hosted there because Supabase serves Edge Function and
// Storage HTML as text/plain (anti-phishing), so it can't host pages itself
// (same constraint that made /join a redirect).

import type { PostSong } from './song.ts';

/** Override with the GALLERY_BASE_URL secret (e.g. after moving to a custom domain). */
const GALLERY_BASE_URL = Deno.env.get('GALLERY_BASE_URL')
  ?? 'https://omermizrahi15.github.io/follow-me/gallery.html';

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
 */
export async function savePostGallery(
  supabase: SupabaseClient,
  publisherId: string,
  mediaUrls: string[],
  song?: PostSong | null,
): Promise<string | null> {
  try {
    const id = await postId(publisherId, mediaUrls);
    const { error } = await supabase
      .from('posts')
      .upsert({ id, publisher_id: publisherId, media_urls: mediaUrls, song: song ?? null });
    if (error != null) throw new Error(error.message);
    return `${GALLERY_BASE_URL}?id=${id}`;
  } catch (err) {
    console.error('savePostGallery failed:', err);
    return null;
  }
}
