/**
 * The vision provider seam.
 *
 * Grading photos is one narrow ask — hand a model some images and a prompt, get
 * back one JSON entry per image — and which vendor answers it has turned out to
 * be the least stable thing about this function. Gemini 2.0/2.5 had their free
 * tier set to `limit: 0` with no notice, and 3.5-flash allows twenty requests a
 * DAY, which is not enough to grade a single week of travel photos.
 *
 * So the vendor is a runtime choice, not a code one: implementations live behind
 * this interface, `VISION_PROVIDER` picks one, and switching is a secret change
 * plus a redeploy rather than a rewrite. The app never learns which one answered.
 */

/** An image already decoded and ready to attach to a request. */
export interface ResolvedImage {
  data: string;
  mimeType: string;
}

/** Why a provider refused, in terms the handler can turn into an app-facing reason. */
export interface VisionFailure {
  /** Upstream HTTP status, or 0 when the request never completed. */
  status: number;
  /** Raw body, kept verbatim for the log — this is what diagnosed the 20/day cap. */
  body: string;
  /** Seconds the provider asked us to wait, when it named one. */
  retryAfterSeconds: number | null;
  /**
   * A per-DAY ceiling rather than a per-minute one.
   *
   * The distinction is the difference between pausing and stopping, and every
   * provider blurs it: they answer both with 429 and attach a sub-minute retry
   * delay to both. Waiting out a daily cap spends more of a budget that is
   * already gone, which is exactly how a scan hangs forever.
   */
  dailyQuota: boolean;
}

/**
 * One ceiling the provider enforces, and how much of it is left.
 *
 * Both numbers are the provider's own, read off the response it just sent —
 * never ours. That distinction is the whole point of this type: the app used to
 * show publishers "500 photos a day", a figure invented in this function's env
 * defaults that corresponded to nothing any vendor enforces. The provider's
 * real ceiling has always been on every response; nothing read it.
 */
export interface LimitWindow {
  /** The ceiling, in whatever unit the field it sits on is named for. */
  limit: number;
  /** How much of it is left right now. */
  remaining: number;
  /**
   * Seconds until this window refills, or null when the provider didn't say.
   *
   * Also the only thing that identifies the *period*: providers do not label a
   * limit "per day" or "per minute" anywhere, so a ~180s reset is a per-minute
   * bucket and a ~20-hour one is a daily allowance. Reporting the reset rather
   * than a guessed label keeps this honest when a plan changes underneath us.
   */
  resetSeconds: number | null;
}

/** Everything one provider just said about what it will still accept. */
export interface ProviderLimits {
  provider: string;
  model: string;
  /** Calls left in the current window. */
  requests: LimitWindow | null;
  /**
   * Tokens left in the current window — the ceiling that actually binds this
   * workload. An image costs roughly a thousand, so a token allowance divides
   * into far fewer photos than the request allowance divides into calls, and a
   * scan hits it first. See the usage logging in groq.ts.
   */
  tokens: LimitWindow | null;
  /** When this was observed, epoch ms — a limit is only true for a moment. */
  observedAt: number;
}

/**
 * Seconds in a provider's duration string, rounded up, or null.
 *
 * Providers write these for humans ("2m59.56s", "7.66s", "120ms") rather than
 * as a count, so this is a parser and not a `Number()`. Rounded up because
 * every caller uses it to decide how long to wait, and a wait that ends one
 * moment early buys another 429.
 */
export function parseDurationSeconds(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (text === '') return null;

  // A bare number is already seconds — some providers answer that way.
  if (/^\d+(\.\d+)?$/.test(text)) return Math.ceil(Number(text));

  const units: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 0.001 };
  // `ms` before `s` in the alternation, or "120ms" parses as 120 minutes.
  const parts = text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g);
  let seconds = 0;
  let matched = false;
  for (const [, value, unit] of parts) {
    matched = true;
    seconds += Number(value) * units[unit];
  }
  if (!matched) return null;
  // A sub-second wait is still a wait: rounding it to zero reads as "the
  // window is open again", and the retry it invites is refused immediately.
  return seconds > 0 ? Math.max(1, Math.ceil(seconds)) : 0;
}

/** One `x-ratelimit-*` triplet, or null when the provider named no such limit. */
function limitWindow(headers: Headers, unit: 'requests' | 'tokens'): LimitWindow | null {
  const limit = Number(headers.get(`x-ratelimit-limit-${unit}`));
  const remaining = Number(headers.get(`x-ratelimit-remaining-${unit}`));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return null;
  // An absent header reads as 0 through Number(), which is a real value here —
  // so require the header to actually exist rather than trusting the coercion.
  if (headers.get(`x-ratelimit-limit-${unit}`) == null) return null;
  if (headers.get(`x-ratelimit-remaining-${unit}`) == null) return null;
  return {
    limit,
    remaining,
    resetSeconds: parseDurationSeconds(headers.get(`x-ratelimit-reset-${unit}`)),
  };
}

/**
 * What a response's `x-ratelimit-*` headers say the account may still spend.
 *
 * Null when the provider stated nothing, and deliberately so: a zeroed-out
 * shape would render as "0 of 0 left", a wall that does not exist, which is the
 * same kind of fiction as the invented daily quota this replaced. Silence is
 * reported as silence.
 *
 * Sent on every response, success or refusal, which is why this takes `Headers`
 * rather than only running on a 429 — the useful moment to learn the ceiling is
 * before it is hit.
 */
export function rateLimitFromHeaders(
  headers: Headers,
  provider: string,
  model: string,
  observedAt: number,
): ProviderLimits | null {
  const requests = limitWindow(headers, 'requests');
  const tokens = limitWindow(headers, 'tokens');
  if (requests == null && tokens == null) return null;
  return { provider, model, requests, tokens, observedAt };
}

/**
 * Both branches carry `limits` because both learn them: the headers ride on a
 * success just as they ride on a refusal, and waiting for a 429 to find out
 * what the ceiling is means only ever knowing it once it is already gone.
 */
export type VisionResult =
  | { ok: true; entries: Record<string, unknown>[]; limits: ProviderLimits | null }
  | { ok: false; failure: VisionFailure; limits: ProviderLimits | null };

export interface VisionRequest {
  /** Instructions describing the fields wanted, shared across providers. */
  prompt: string;
  /** The publisher's portrait, when the face preference is on. Never graded itself. */
  reference: ResolvedImage | null;
  /** The photos to grade, in the order their indices refer to. */
  images: ResolvedImage[];
  /**
   * Machine-readable response shape, for providers that enforce one.
   *
   * Ignored by providers whose `enforcesSchema` is false — they are told the
   * shape in the prompt instead. Passing it either way keeps the caller from
   * having to know which kind it is talking to.
   */
  responseSchema?: Record<string, unknown>;
}

export interface VisionProvider {
  readonly name: string;
  /**
   * Images this provider accepts in ONE call, the reference portrait included.
   *
   * Providers differ by a lot here — Gemini takes a dozen comfortably, Groq caps
   * at five — so the caller chunks to this number rather than to a constant. It
   * is deliberately not the same as the function's own MAX_PHOTOS_PER_REQUEST:
   * that one is the app-facing contract and must not move when the vendor does.
   */
  readonly maxImagesPerCall: number;
  /**
   * Whether the provider enforces the response shape itself.
   *
   * Gemini takes a responseSchema and guarantees the shape; Groq offers only
   * "must be valid JSON". The prompt spells the shape out in words when this is
   * false, because a model told to return JSON and nothing more will invent its
   * own field names.
   */
  readonly enforcesSchema: boolean;
  classify(request: VisionRequest): Promise<VisionResult>;
}

/**
 * Entries out of a parsed body, whatever the provider wrapped them in.
 *
 * A bare array is what a schema-enforcing provider returns. JSON-mode providers
 * usually cannot return a top-level array at all, so they are asked for
 * `{"results": [...]}` — and models being models, `photos`/`classifications`
 * show up too. Accepting the obvious wrappers costs nothing; refusing them
 * throws away a whole batch that was correctly graded.
 */
export function entriesFrom(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed == null || typeof parsed !== 'object') return [];
  const obj = parsed as Record<string, unknown>;
  for (const key of ['results', 'classifications', 'photos', 'entries', 'items']) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

/**
 * Seconds named in a `Retry-After` header, or null.
 *
 * Providers disagree about where the delay lives — Gemini buries it in the body,
 * OpenAI-compatible ones put it in the header — so both are read and neither is
 * assumed.
 */
export function retryAfterHeader(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw == null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

/**
 * Whether a failure means "this provider is done — try the next one".
 *
 * The distinction that matters is exhausted versus busy. A spent daily budget,
 * a bad key, an unreachable host or a broken vendor are all permanent for this
 * request, and falling through costs nothing. A per-minute rate limit is not:
 * it clears on its own in seconds, and spending a scarce fallback budget on a
 * pause that would have ended by itself is how a safety net gets used up before
 * it is needed. Those propagate to the app, which waits and retries.
 *
 * Unrecognised statuses stay put for the same reason — falling through on
 * everything makes the fallback the main road by accident.
 */
export function isProviderExhausted(failure: VisionFailure): boolean {
  if (failure.dailyQuota) return true;
  // Never completed — DNS, TLS, timeout.
  if (failure.status === 0) return true;
  // Missing or rejected credentials: no amount of retrying fixes this one.
  if (failure.status === 401 || failure.status === 403) return true;
  // The request itself was refused. Another vendor may well accept it — this is
  // how a payload one provider considers too large still gets graded.
  if (failure.status === 400) return true;
  // The vendor is broken, not busy.
  if (failure.status >= 500) return true;
  return false;
}
