import type { ProviderLimits } from './vision.ts';
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
 *
 * `upstream_busy` is the third: the vendor was momentarily unable to answer at
 * all (Gemini's 503 "the model is overloaded"). It says nothing about any
 * budget — it is the same request being worth making again in a few seconds —
 * so it must not reach the app as a broken classifier (issue #189).
 */
export type RefusalReason = 'daily_quota' | 'rate_limited' | 'upstream_busy';

/**
 * True when an upstream status is a moment rather than a verdict.
 *
 * A vendor that is overloaded, down, or never reached will very likely answer
 * the identical request seconds later. Telling the app that its classifier is
 * broken ends the scan and throws away every grade in flight, which is what
 * issue #189 filed: a single Gemini 503 surfaced as ClassificationFailedError.
 *
 * 429 is deliberately excluded: it has its own two reasons and its own waits,
 * and folding it in here would lose the difference between "busy" and "come
 * back tomorrow".
 */
export function isTransientUpstream(status: number): boolean {
  // 0 is the local marker for a request that never completed at all.
  return status === 0 || (status >= 500 && status <= 599);
}

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
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Classification {
  id: string;
  category: Category;
  confidence: number;
  quality: number;
  /**
   * The judgements `quality` was computed from, when the model stated any.
   *
   * Carried so the grade inspector can say WHY a photo scored what it did —
   * "0.31" explains nothing, "sharpness 0.2, appeal 0.9" explains everything —
   * and so a future weighting change can be applied to existing grades instead
   * of re-buying them.
   */
  factors?: QualityFactors;
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
  /**
   * One sentence from the model on why this photo got this grade.
   *
   * Exists because the numbers never explained themselves. A 0.35 quality on a
   * photo the publisher likes is unarguable-with until something says "motion
   * blur on the subject" — and without that, the only way to disagree with the
   * AI was to distrust all of it. Empty when the model volunteered nothing, and
   * empty on every grade bought before this field existed; never filled in with
   * a guess, because a plausible rationale attached to a grade nobody explained
   * is worse than a blank.
   */
  reason: string;
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

/**
 * Longest rationale kept, in characters.
 *
 * The model is asked for one short sentence and usually gives one, but a
 * rambling answer is stored on the device for every graded photo — five
 * thousand of them, in a single AsyncStorage blob with a size limit. Trimming
 * bounds that; the first 200 characters carry the reason in every sample seen.
 */
export const MAX_REASON_LENGTH = 200;

/** Coerce anything to a 0..1 score; non-finite input becomes 0. */
export function clamp01(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** The known Category for `c`, or null when the model returned something else. */
/**
 * Categories that no longer exist, and what they became.
 *
 * `cultural` was retired: museums, temples and historic sites are buildings,
 * and a category that mostly duplicated `architecture` only gave the model
 * another way to split photos that belong together — which showed up as a
 * publisher who had switched `architecture` on still not being offered the
 * cathedral they photographed.
 *
 * Folded rather than dropped, because `parseClassification` THROWS on an
 * unrecognised category (deliberately — a broken model contract must never
 * reach the device disguised as a grade). A model still answering "cultural"
 * from a cached prompt, or a stored grade bought before this change, would
 * otherwise take a whole batch down with it.
 */
const RETIRED_CATEGORIES: Record<string, Category> = {
  cultural: 'architecture',
};

export function asCategory(c: unknown): Category | null {
  if (CATEGORIES.includes(c as Category)) return c as Category;
  return typeof c === 'string' ? RETIRED_CATEGORIES[c] ?? null : null;
}

/**
 * The four judgements quality is built from, each 0..1. Every one is optional:
 * a model that answered the old single-number shape must still be readable.
 */
export interface QualityFactors {
  /** Focus and motion blur, and nothing else. */
  sharpness?: number;
  /** Light: blown highlights, crushed shadows, flat grey. */
  exposure?: number;
  /** Framing — horizon, clutter, where the subject sits. */
  composition?: number;
  /** Whether the picture is worth stopping on. The only subjective one. */
  appeal?: number;
}

/**
 * How much each judgement is worth.
 *
 * Sharpness and exposure together carry more than half, because they decide
 * whether the image is usable at all: no amount of subject appeal recovers a
 * smeared frame, while a plain photo that is simply well taken is postable.
 * Appeal carries the most of the remainder because it is the only one that
 * knows the difference between a wall and a view.
 */
const QUALITY_WEIGHTS: Required<QualityFactors> = {
  sharpness: 0.3,
  exposure: 0.25,
  composition: 0.15,
  appeal: 0.3,
};

/**
 * A factor the model did not answer counts as the middle of the scale.
 *
 * Not zero. Absent means "not stated", and scoring it zero punishes the photo
 * for the model's omission — which, on a response that omitted several, would
 * bury a good picture under an answer nobody gave.
 */
const UNSTATED_FACTOR = 0.5;

/**
 * The four judgements as one number.
 *
 * Asking for quality as a single 0..1 score produced almost no signal: 132
 * photos graded on staging came back with a mean of 0.696 and a standard
 * deviation of 0.042 — everything inside a 0.16-wide band, 37 of them on
 * exactly 0.70. That is the ordinary behaviour of an unanchored holistic ask,
 * and it made the grade useless for ranking.
 *
 * Photos fail in different ways, and the ways are close to independent: a
 * blurred frame of a wonderful moment and a razor-sharp picture of a blank wall
 * both average out to "about 0.7" when judged as one thing. Asked separately
 * they separate — 0.2/0.9 against 0.95/0.2 — and the weighted sum of answers
 * that disagree lands somewhere the huddle never reached.
 */
export function qualityFrom(factors: QualityFactors): number {
  let total = 0;
  for (const [name, weight] of Object.entries(QUALITY_WEIGHTS)) {
    const stated = factors[name as keyof QualityFactors];
    total += weight * (typeof stated === 'number' ? clamp01(stated) : UNSTATED_FACTOR);
  }
  return clamp01(total);
}

/**
 * The four judgements written out, for the grade inspector.
 *
 * Appended to `reason` rather than carried as its own field, so the breakdown
 * reaches the inspector that already exists without a response-shape change on
 * the device and a migration behind it. "0.31" explains nothing about a photo;
 * "sharp 0.2 · light 0.85 · framing 0.6 · appeal 0.95" explains all of it, and
 * explaining it is the point of asking for the four separately.
 */
function factorBreakdown(factors: QualityFactors): string {
  const parts: string[] = [];
  const say = (label: string, value: number | undefined): void => {
    if (typeof value === 'number') parts.push(`${label} ${Number(value.toFixed(2))}`);
  };
  say('sharp', factors.sharpness);
  say('light', factors.exposure);
  say('framing', factors.composition);
  say('appeal', factors.appeal);
  return parts.join(' · ');
}

/** The factors the model actually stated, or undefined if it stated none. */
function statedFactors(parsed: Record<string, unknown>): QualityFactors | undefined {
  const factors: QualityFactors = {};
  let any = false;
  for (const name of Object.keys(QUALITY_WEIGHTS) as (keyof QualityFactors)[]) {
    const raw = parsed[name];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      factors[name] = clamp01(raw);
      any = true;
    }
  }
  return any ? factors : undefined;
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
/**
 * The model's sentence, with the factor breakdown after it.
 *
 * The sentence is truncated BEFORE the breakdown is appended: a model that used
 * every word of its allowance would otherwise push the numbers off the end,
 * losing the explanation precisely when the sentence was least useful.
 */
function reasonWith(raw: unknown, factors: QualityFactors | undefined): string {
  const sentence = typeof raw === 'string' ? raw.trim().slice(0, MAX_REASON_LENGTH) : '';
  if (factors == null) return sentence;
  const breakdown = factorBreakdown(factors);
  if (breakdown === '') return sentence;
  return sentence === '' ? breakdown : `${sentence} · ${breakdown}`;
}

export function parseClassification(
  id: string,
  parsed: Record<string, unknown>,
  askedForReference = false,
): Classification {
  const factors = statedFactors(parsed);
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
    // Computed from the factors when the model gave any. A model still
    // answering the old single-number shape — the first request after a
    // deploy, or a provider whose schema lagged — keeps its stated quality
    // rather than being scored as though every factor were missing, which
    // would flatten an entire batch onto the middle of the scale.
    quality: factors == null ? clamp01(parsed.quality) : qualityFrom(factors),
    ...(factors != null ? { factors } : {}),
    caption: typeof parsed.caption === 'string' ? parsed.caption : '',
    scene: typeof parsed.scene === 'string' ? parsed.scene.toLowerCase().trim() : '',
    contains_reference_person: askedForReference && parsed.contains_reference_person === true,
    reference_confidence: askedForReference ? clamp01(parsed.reference_confidence) : 0,
    reason: reasonWith(parsed.reason, factors),
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
  /**
   * Our own ceiling, or null when we impose none and the provider's limit is
   * the only wall. Null is the default — see dailyQuotaFrom.
   */
  limit: number | null;
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
/**
 * Our own per-user daily ceiling, from the raw `CLASSIFY_DAILY_QUOTA` secret.
 *
 * Null means we impose none — the new default, and a correction rather than a
 * loosening. The old default was 500 photos per user per day: a number invented
 * here, matching nothing any vendor enforces, counted per user where every real
 * limit is per account, and — because it was the only figure the function could
 * report — the number the app showed publishers as though it were the truth
 * about the AI. The provider states its actual ceilings on every response (see
 * rateLimitFromHeaders); those are the wall, and this is now only a cost brake
 * for whoever wants one.
 *
 * Zero is kept distinct from unset on purpose: it is the deliberate kill switch
 * that turns classification off, so it must not fall through to "no ceiling".
 * Anything unparseable does fall through — a typo'd secret reinstating a made-up
 * limit is exactly the failure this is undoing.
 */
export function dailyQuotaFrom(raw: string | undefined | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

export function quotaSnapshot(count: unknown, limit: number | null, day: string): QuotaSnapshot {
  const used = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, count) : 0;
  return { used, limit, day };
}

/**
 * The vision providers to try, in order, from the `VISION_PROVIDER` secret.
 *
 * The default is `groq,gemini`, and it used to be `gemini` alone. Gemini's free
 * tier is not a tier any more: 2.0/2.5-flash are set to `limit: 0`, and
 * 3.5-flash — the one live model with a free allowance — allows twenty requests
 * a DAY. Twelve photos travel per request, so a day's entire budget is 240
 * photos across every publisher on the project, and the history backfill (which
 * grades one window per posting interval) spends it inside its first stretch
 * and then waits three minutes per window against a wall that lifts tomorrow.
 * Leading with Groq is what makes the feature work at all; Gemini stays behind
 * it as the fallback rather than being removed.
 *
 * Unknown names and missing keys are the caller's problem — this is the parse,
 * not the resolution. Case and spacing are normalised because the value is
 * typed by a human into a secrets UI.
 */
export function requestedProviders(raw: string | undefined | null): string[] {
  const names = (raw ?? '')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(name => name !== '');
  return names.length > 0 ? names : ['groq', 'gemini'];
}

/**
 * Roughly what one image costs a vision provider in tokens.
 *
 * Measured, not assumed: every Groq call logs `total_tokens` against the image
 * count, and a 768px-wide image (see CLASSIFY_IMAGE_WIDTH) comes in around a
 * thousand. Approximate on purpose — it decides whether to wait a few seconds,
 * and being 20% out changes nothing about that decision.
 */
export const TOKENS_PER_IMAGE = 1_000;

/**
 * How long a token window lasts when the provider did not say.
 *
 * Groq's token ceiling is per minute, and every provider that meters tokens at
 * all meters them per minute. A minute is therefore the honest default for a
 * response that reported a spent budget without a reset.
 */
export const TOKEN_WINDOW_SECONDS = 60;

/**
 * How long to hold off before a call, given what the provider last said.
 *
 * Tokens, not requests, are what bounds this workload: Groq's free tier allows
 * 8,000 tokens a MINUTE against 1,000 requests a day, and an image costs about
 * a thousand tokens — so the real ceiling is roughly eight photos a minute,
 * and the request allowance is never reached. The app was sending twelve
 * photos per request with four requests in flight: about 48,000 tokens against
 * an 8,000 budget, six times over in the first second of every scan. Every
 * scan 429'd, fell through to Gemini's twenty-requests-a-DAY, and died there —
 * which is why the usage panel reported Gemini on a deployment configured to
 * grade on Groq.
 *
 * The numbers that say all this are on every response the provider sends and
 * nothing read them. This does.
 *
 * Zero when nothing is known, which is deliberate: the first call of a request
 * has heard nothing yet, so it goes, and what comes back paces everything
 * after it. Guessing a wait from no information would just make the common
 * case slower for nothing.
 */
export function pacingWaitSeconds(
  limits: ProviderLimits | null,
  imagesInCall: number,
): number {
  const tokens = limits?.tokens;
  if (tokens == null) return 0;

  const cost = Math.max(1, imagesInCall) * TOKENS_PER_IMAGE;
  if (tokens.remaining >= cost) return 0;

  // A window that has to refill before this call can afford to run. Firing
  // anyway buys a 429, and a 429 is what sends the scan down the chain to a
  // provider with a twentieth of the budget — waiting is strictly cheaper.
  return tokens.resetSeconds ?? TOKEN_WINDOW_SECONDS;
}
