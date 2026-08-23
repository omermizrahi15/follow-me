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

export type VisionResult =
  | { ok: true; entries: Record<string, unknown>[] }
  | { ok: false; failure: VisionFailure };

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
