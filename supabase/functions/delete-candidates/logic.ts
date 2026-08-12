// Pure helpers for delete-candidates, split out of index.ts for unit testing:
// request scoping, Cloudinary public-id parsing, signed-destroy signature building.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How far back the delete reaches, as an ISO timestamp — or null for "all of
 * it", which is what the privacy wipe means.
 *
 * One endpoint serves two callers: the user pressing "remove my photos from the
 * cloud" (no scope, delete everything) and the app's routine retention pass
 * after each sync (`olderThanDays`, drop what has aged out of the window).
 * Anything that isn't a positive finite number is treated as absent rather than
 * rejected — an unparseable scope must never silently narrow a wipe the user
 * asked for, and a full wipe is the safe reading of "delete my photos".
 */
export function ageCutoffIso(body: unknown, now: number): string | null {
  const days = (body as { olderThanDays?: unknown } | null)?.olderThanDays;
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return null;
  return new Date(now - days * MS_PER_DAY).toISOString();
}

/** Extracts the Cloudinary public id (folder path + name, no extension) from a delivery URL. */
export function publicIdFromUrl(url: string): string | null {
  const m = url.match(/\/image\/upload\/(?:[^/]+\/)*?v\d+\/(.+?)(\.[A-Za-z0-9]+)?$/);
  return m?.[1] ?? null;
}

export async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cloudinary signed-destroy signature: SHA-1 of the sorted params joined with the API secret. */
export function cloudinaryDestroySignature(publicId: string, timestamp: number, apiSecret: string): Promise<string> {
  return sha1Hex(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`);
}
