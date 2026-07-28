// Pure helpers for post-batch, split out of index.ts for unit testing.

/**
 * Title/body for the "we posted it" push — the second half of the background
 * "Post now" flow. The publisher pressed a button and the app never opened, so
 * this notification is the only confirmation they get: it has to say what went
 * out, to how many people, and (tapped) show them the post.
 */
export function postedPushContent(
  photoCount: number,
  subscriberCount: number,
  place?: string | null,
): { title: string; body: string } {
  const where = place != null && place.trim() !== '' ? ` from ${place.trim()}` : '';
  const title = `Posted ${photoCount} photo${photoCount === 1 ? '' : 's'}${where} ✅`;
  const body =
    subscriberCount === 0
      ? 'No followers yet — tap to see your post.'
      : `Sent to ${subscriberCount} follower${subscriberCount === 1 ? '' : 's'}. Tap to view.`;
  return { title, body };
}

/** Title/body for the push sent when a "Post now" could not be honoured. */
export function postFailedPushContent(): { title: string; body: string } {
  return {
    title: "Couldn't post your photos",
    body: 'Something went wrong sending them. Tap to review and post manually.',
  };
}

/** A photo as stored in `approval_batches.batch` — the subset publishing needs. */
export interface StoredBatchPhoto {
  id: string;
  url: string;
  createdAt: number;
}

/**
 * Keep only entries that can actually be published: an id and a real https URL.
 * The stored batch is jsonb written by an older deploy of auto-post, so it is
 * treated as untrusted shape rather than assumed.
 */
export function publishablePhotos(batch: unknown): StoredBatchPhoto[] {
  if (!Array.isArray(batch)) return [];
  return batch.flatMap((raw): StoredBatchPhoto[] => {
    if (raw == null || typeof raw !== 'object') return [];
    const { id, url, createdAt } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') return [];
    if (typeof url !== 'string' || !url.startsWith('http')) return [];
    return [{ id, url, createdAt: typeof createdAt === 'number' ? createdAt : Date.now() }];
  });
}
