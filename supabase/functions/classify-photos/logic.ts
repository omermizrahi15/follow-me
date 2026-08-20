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

/**
 * Why a request was refused, when the answer is 429.
 *
 * Two entirely different walls used to share that status code with nothing to
 * tell them apart, so the app announced both as "today's AI limit is used up".
 * One of them clears in half a minute:
 *
 * - `daily_quota` — OUR per-user ceiling (increment_classify_quota). Real until
 *   tomorrow; nothing the user does today will help.
 * - `rate_limited` — Gemini's requests-per-minute cap on the API key. The free
 *   tier allows 5/minute per model, and the app classifies 4 photos at a time,
 *   so a scan trips this within seconds of starting and recovers on its own
 *   seconds later. Carries `retry_after_seconds` from Gemini's own RetryInfo.
 */
export type RefusalReason = 'daily_quota' | 'rate_limited';

/**
 * Seconds Gemini asked us to wait, from a 429 body, or null when it didn't say.
 *
 * Google reports this twice — a `RetryInfo` detail with a duration string
 * ("28s") and prose in `message` ("Please retry in 28.530505825s") — and which
 * one is present varies. Read the structured field first and fall back to the
 * prose, because guessing a delay is what turned a 28-second pause into "come
 * back tomorrow".
 */
export function parseRetryDelaySeconds(body: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const details = (parsed as { error?: { details?: unknown[] } })?.error?.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      const delay = (detail as { retryDelay?: unknown })?.retryDelay;
      if (typeof delay === 'string') {
        const seconds = Number(delay.replace(/s$/, ''));
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
      }
    }
  }
  const message = (parsed as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') {
    const match = /retry in ([\d.]+)\s*s/i.exec(message);
    const seconds = match != null ? Number(match[1]) : NaN;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  }
  return null;
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
  /**
   * Whether the person in the request's reference image appears in this photo
   * (issue #137). Always false when the request carried no reference — the
   * question is not put to the model at all in that case.
   */
  contains_reference_person: boolean;
  /** Model confidence in the above, 0..1. Zero when unasked. */
  reference_confidence: number;
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

/** The known Category for `c`, or null when the model returned something else. */
export function asCategory(c: unknown): Category | null {
  return CATEGORIES.includes(c as Category) ? (c as Category) : null;
}

/**
 * Turn the model's parsed JSON into a Classification.
 *
 * Scores and free text are still defaulted defensively — a missing caption is
 * cosmetic — but an unrecognised `category` throws instead of becoming `other`.
 * The distinction matters because `other` is a real answer the model gives on
 * purpose (screenshots, receipts, blurry shots), so *inventing* one for a
 * malformed response let a broken model contract reach the device disguised as
 * a confident grade. Since `other` is excluded from the swap pool and grades
 * are remembered for months, that quietly retired the photo for good.
 *
 * `askedForReference` says whether a reference image went out with the request.
 * When it didn't, the face fields are forced to false/0 no matter what the model
 * volunteered — the honest answer to a question nobody asked, and the one the
 * selection rules are written to read (see PhotoFacts.containsPublisher).
 */
export function parseClassification(
  id: string,
  parsed: Record<string, unknown>,
  askedForReference = false,
): Classification {
  const category = asCategory(parsed.category);
  if (category == null) {
    throw new Error(
      `classify ${id}: model returned unknown category ${JSON.stringify(parsed.category)}`,
    );
  }
  return {
    id,
    category,
    confidence: clamp01(parsed.confidence),
    quality: clamp01(parsed.quality),
    caption: typeof parsed.caption === 'string' ? parsed.caption : '',
    scene: typeof parsed.scene === 'string' ? parsed.scene.toLowerCase().trim() : '',
    contains_reference_person: askedForReference && parsed.contains_reference_person === true,
    reference_confidence: askedForReference ? clamp01(parsed.reference_confidence) : 0,
  };
}
