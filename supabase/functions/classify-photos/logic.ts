// Pure classification helpers for classify-photos, split out of index.ts for
// unit testing: the category set, score/category normalization, base64 encoding,
// defensive parsing of the model's JSON response, and who the caller is.

/**
 * Who is calling classify-photos.
 *
 * `service` is `auto-post` on a cron tick: it holds the service-role key and no
 * user session, so it names the publisher whose quota it spends. `user-token` is
 * the app, and the token still has to be checked against the auth server.
 * `rejected` covers the anon key, no key, and a service call that named nobody.
 */
export type Caller =
  | { kind: 'service'; userId: string }
  | { kind: 'user-token'; token: string }
  | { kind: 'rejected' };

/**
 * Decides which of the three the request is, without any network call.
 *
 * The service-role branch exists because rejecting that key broke autonomous
 * posting outright: `auto-post` cannot build a due publisher's batch without
 * classifying their photos, so every due cron tick died on a 401 and no push
 * went out. It is deliberately not an exemption from the daily quota — a service
 * call with no `x-publisher-id` is `rejected`, so the cost ceiling can't be
 * skipped by omitting a header.
 */
export function classifyCaller(
  authHeader: string | null,
  publisherIdHeader: string | null,
  serviceKey: string,
): Caller {
  const token = (authHeader ?? '').replace(/^Bearer\s+/i, '').trim();
  if (token === '') return { kind: 'rejected' };
  if (serviceKey !== '' && token === serviceKey) {
    const userId = (publisherIdHeader ?? '').trim();
    return userId !== '' ? { kind: 'service', userId } : { kind: 'rejected' };
  }
  return { kind: 'user-token', token };
}

export const CATEGORIES = [
  'selfie_with_view',
  'sunset_sunrise',
  'architecture',
  'selfie_with_people',
  'food',
  'nature',
  'night_scene',
  'cultural',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Classification {
  id: string;
  category: Category;
  confidence: number;
  quality: number;
  caption: string;
  scene: string;
}

/** btoa over arbitrary bytes, chunked to avoid the argument-count limit on large images. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Coerce anything to a 0..1 score; non-finite input becomes 0. */
export function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Map an arbitrary value to a known Category, defaulting unknowns to 'other'. */
export function normalizeCategory(c: unknown): Category {
  return CATEGORIES.includes(c as Category) ? (c as Category) : 'other';
}

/** Turn the model's parsed JSON into a safe Classification (bad/missing fields defaulted). */
export function parseClassification(id: string, parsed: Record<string, unknown>): Classification {
  return {
    id,
    category: normalizeCategory(parsed.category),
    confidence: clamp01(parsed.confidence),
    quality: clamp01(parsed.quality),
    caption: typeof parsed.caption === 'string' ? parsed.caption : '',
    scene: typeof parsed.scene === 'string' ? parsed.scene.toLowerCase().trim() : '',
  };
}
