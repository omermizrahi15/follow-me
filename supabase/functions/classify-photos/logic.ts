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
 * - `rate_limited` — Gemini's requests-per-MINUTE cap on the API key. A scan
 *   trips this within seconds of starting and recovers on its own seconds
 *   later. Carries `retry_after_seconds` from Gemini's own RetryInfo.
 *
 * Gemini has a THIRD wall that also arrives as a 429 and used to be reported as
 * the second one: a requests-per-DAY cap (20/day per model on the free tier).
 * Google attaches a RetryInfo of under a minute to it anyway, so honouring that
 * delay means retrying a quota that cannot recover for hours — every retry
 * spending another request from a budget that is already gone. That is how a
 * scan sat on "Scanning your library" indefinitely. Told apart by quotaId, and
 * reported as `daily_quota`, because from the app's side it means exactly what
 * our own ceiling means: nothing today will help.
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
/**
 * True when a Gemini 429 is the per-DAY request cap rather than the per-minute one.
 *
 * Read from `quotaId` (e.g. "GenerateRequestsPerDayPerProjectPerModel-FreeTier")
 * rather than from the limit value, because the numbers move between tiers and
 * models while the period in the id does not. Anything we cannot positively
 * identify as per-day stays per-minute: waiting a minute on a daily wall costs
 * one pointless retry, but treating a recoverable minute as a dead day retires
 * a scan that would have succeeded on its own.
 */
export function isDailyQuotaError(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const details = (parsed as { error?: { details?: unknown[] } })?.error?.details;
  if (!Array.isArray(details)) return false;
  for (const detail of details) {
    const violations = (detail as { violations?: unknown[] })?.violations;
    if (!Array.isArray(violations)) continue;
    for (const violation of violations) {
      const id = (violation as { quotaId?: unknown })?.quotaId;
      if (typeof id === 'string' && /PerDay/i.test(id)) return true;
    }
  }
  return false;
}

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

// --- Batched grading --------------------------------------------------------
//
// Grading was one Gemini call per photo, at full resolution. Against a free
// tier of 5 requests per minute that made a 150-photo window a ~30-minute wait,
// and it had nothing to do with the model: a classification only needs to know
// "sunset or dinner plate", which a 512px thumbnail answers as well as a 1.5MB
// original. Smaller images are what make batching possible, and batching is
// what turns the per-minute cap from the binding constraint into a non-issue.

/**
 * Longest edge, in pixels, of the image actually sent to the model.
 *
 * Measured on a real candidate: 1.5MB at full size, 123KB at 768px, 64KB at
 * 512px. Twelve full-size images would be ~17MB, essentially the whole inline
 * payload budget — so downscaling is not a saving bolted onto batching, it is
 * what makes batching possible at all.
 *
 * 768 rather than 512 because `quality` grades sharpness, and sharpness is
 * precisely what a downscale destroys: at 512 a blurry photo is indistinguishable
 * from a sharp one (verified by eye against a night shot from the staging set),
 * which would quietly inflate quality scores and let blurry photos through the
 * publisher's minQuality floor. Category, scene and caption survive 512 easily;
 * this width is chosen for the one attribute that does not. Twelve of these is
 * ~1.4MB a request, still far inside the limit.
 */
export const CLASSIFY_IMAGE_WIDTH = 768;

/**
 * Rewrites a Cloudinary delivery URL to fetch a downscaled, re-encoded copy.
 *
 * Returns the URL untouched when it isn't Cloudinary or already carries a
 * transformation — guessing at an unknown URL shape would break the fetch, and
 * a caller that already asked for a specific rendition meant it.
 */
export function downscaledUrl(url: string, width: number = CLASSIFY_IMAGE_WIDTH): string {
  const marker = '/image/upload/';
  const at = url.indexOf(marker);
  if (at === -1) return url;

  const rest = url.slice(at + marker.length);
  // A transformation segment is the first path component when it carries
  // Cloudinary's `key_value` shape; a bare `v123/folder/file.jpg` has none.
  const firstSegment = rest.split('/')[0] ?? '';
  if (/^[a-z]+_[^/]*$/.test(firstSegment)) return url;

  return `${url.slice(0, at + marker.length)}w_${width},c_limit,q_auto/${rest}`;
}

/**
 * Pairs each graded entry back to the photo id it describes.
 *
 * The model is asked for an explicit 0-based `index` per image rather than a
 * bare ordered array, because a silently shortened or reordered array would
 * attach one photo's grade to another — and a wrong grade is worse than a
 * missing one: it is cached, it steers selection, and nothing about it looks
 * like a failure. Entries whose index is missing, duplicated, or out of range
 * are dropped, so the caller sees a photo it did not get an answer for instead
 * of an answer that belongs to a different photo.
 */
export function pairBatchResults(
  ids: readonly string[],
  entries: readonly Record<string, unknown>[],
): { paired: { id: string; parsed: Record<string, unknown> }[]; missing: string[] } {
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const entry of entries) {
    const raw = entry?.index;
    const index = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= ids.length) continue;
    // First answer for an index wins; a duplicate index means the model lost
    // track of the ordering, and picking the later one is no more principled.
    if (!byIndex.has(index)) byIndex.set(index, entry);
  }

  const paired: { id: string; parsed: Record<string, unknown> }[] = [];
  const missing: string[] = [];
  ids.forEach((id, i) => {
    const entry = byIndex.get(i);
    if (entry == null) missing.push(id);
    else paired.push({ id, parsed: entry });
  });
  return { paired, missing };
}

/** Today's spend against today's ceiling, as the app's usage bar reads it. */
export interface QuotaSnapshot {
  /** Photos counted against this publisher today. May exceed `limit` — see below. */
  used: number;
  /** DAILY_QUOTA, the server's own ceiling. */
  limit: number;
  /** The DB's `current_date` for the count, ISO `YYYY-MM-DD`. */
  day: string;
}

/**
 * Shapes what the quota RPC returned into the snapshot the app renders.
 *
 * `count` is deliberately `unknown`: the RPC fails open, so "we could not read
 * the counter" arrives as null and has to mean *nothing spent* — the same
 * answer the request path gives it, where an unreadable count lets the request
 * through. Reporting a full bar there would tell a publisher their budget was
 * gone at the exact moment the server stopped enforcing it.
 *
 * An overshoot is passed through as it stands. The counter is incremented
 * before a request is judged, so a day that ended on a refusal genuinely sits
 * above the ceiling; the client clamps it for display and keeps the raw number.
 */
export function quotaSnapshot(count: unknown, limit: number, day: string): QuotaSnapshot {
  const used = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, count) : 0;
  return { used, limit, day };
}
