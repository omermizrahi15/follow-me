/**
 * Supabase Edge Function: POST /classify-photos
 * Body: { "photos": [{ "id": string, "url"?: string, "base64"?: string, "mimeType"?: string }],
 *         "reference"?: { "url"?: string, "base64"?: string, "mimeType"?: string } }
 * Returns: { "classifications": [{ id, category, confidence, quality, caption, scene,
 *                                  reason, contains_reference_person,
 *                                  reference_confidence }],
 *             "limits": ProviderLimits | null }
 *
 * `reason` is the model's own one-sentence account of why a photo got the
 * category and quality it did. The scores alone were unarguable-with: a 0.35 on
 * a photo the publisher likes gave them nothing to disagree with except the
 * whole feature. See the grade inspector in the app.
 *
 * Also: GET /classify-photos → { "used", "limit": number | null, "day",
 *                                "provider": ProviderLimits | null,
 *                                "providers": ProviderLimits[] }
 * — the caller's own spend, and what the AI provider says the ACCOUNT may still
 * spend. Same auth as the POST. `limit` is our own optional cost brake and is
 * null unless CLASSIFY_DAILY_QUOTA is set; it used to default to 500 photos a
 * day, a figure invented here that matched no vendor's rules and was
 * nevertheless the only "AI limit" the app could show. `provider` is the real
 * wall, stated by the provider itself on every response and kept in
 * `provider_limits` (migration 20240037). See usageResponse, recordLimits.
 *
 * `reference` is the publisher's profile photo (issue #137). When it is present
 * each photo is additionally judged for whether that same person appears in it,
 * which is what the "photos of me" preference ranks and filters on. It is
 * optional and sent only by a publisher who turned that preference on: with no
 * reference the model is never shown a face to match and the two extra fields
 * come back false/0. Nothing about the reference is stored here — it is fetched
 * per request, used in one prompt, and forgotten.
 *
 * The single place provider specifics live. It holds the provider API keys
 * (never shipped in the app) and asks whichever vision model VISION_PROVIDER
 * names — Groq first by default — to classify each photo into one of the rule
 * categories. Photos may be passed as a public URL (the function fetches the bytes)
 * or as base64 (the app reads local library photos this way, avoiding an upload
 * just to classify). Swapping providers means rewriting only this file.
 *
 * A 429 always carries a `reason` saying which wall was hit — `daily_quota`
 * (ours, lasts until tomorrow) or `rate_limited` (the provider's per-minute
 * ceiling, lifts in seconds, and carries `retry_after_seconds`). They were
 * indistinguishable until issue #141, which is why a throttle two seconds into
 * the first scan of the day told publishers their daily AI limit was gone.
 *
 * Auth: requires a signed-in user's JWT (the anon key alone is rejected) —
 * the endpoint is quota/cost-sensitive. Per-user daily quota enforced via
 * increment_classify_quota() (migration 20240015). `auto-post` calls this from a
 * cron tick, where there is no user session to borrow: it presents the
 * service-role key and names the publisher in `x-publisher-id`. See
 * authenticatedUserId.
 *
 * Which model vendor answers is a runtime choice — see VISION_PROVIDER and
 * vision.ts. The request and response shapes below do NOT change with it, so
 * switching vendors never needs an app release.
 *
 * Env: VISION_PROVIDER (optional, comma-separated chain tried in order,
 *        e.g. "groq,gemini" — default "groq,gemini")
 *      GEMINI_API_KEY (required for gemini), GEMINI_MODEL (optional,
 *        default gemini-3.5-flash)
 *      GROQ_API_KEY (required for groq), GROQ_MODEL (optional,
 *        default qwen/qwen3.6-27b)
 *      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  bytesToBase64,
  CATEGORIES,
  type Classification,
  classifyCaller,
  dailyQuotaFrom,
  downscaledUrl,
  pairBatchResults,
  parseClassification,
  quotaSnapshot,
  type RefusalReason,
  requestedProviders,
} from './logic.ts';
import { geminiProvider } from './gemini.ts';
import { groqProvider } from './groq.ts';
import {
  isProviderExhausted,
  type ProviderLimits,
  type ResolvedImage,
  type VisionFailure,
  type VisionProvider,
} from './vision.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
/**
 * Default model. NOT 2.0/2.5-flash: Google set their free-tier quota to
 * literally 0 ("limit: 0, model: gemini-2.0-flash"), so every call 429s
 * regardless of how little you have used — the model is paid-only now. A live
 * model with a working free tier is the only sane default; override with the
 * GEMINI_MODEL secret to pin a different one.
 */
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash';
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/**
 * Photos per request — and, now, per Gemini call.
 *
 * This was 3, and each of the three was its own Gemini call made in sequence,
 * so the number only ever decided how long one request ran. Every photo cost a
 * slot from a free tier that allows 5 requests per MINUTE, which made a
 * 150-photo window roughly half an hour of grading.
 *
 * The images now travel together in a single call, so this is a genuine divisor
 * on the rate limit rather than a batch size in name only: twelve photos cost
 * one slot instead of twelve. Twelve downscaled images is well under a megabyte
 * (see CLASSIFY_IMAGE_WIDTH) and leaves ample headroom under Gemini's inline
 * payload limit; the ceiling on raising it further is the model's attention
 * across many images in one context, not the transport.
 */
const MAX_PHOTOS_PER_REQUEST = 12;
/**
 * Our own per-user photos-per-day ceiling — and now OFF unless someone sets it.
 *
 * It used to default to 500, which was a number with no source. It is not what
 * any vendor enforces; it counts per user where every provider limit is per
 * account; and because it was the only figure this function could report, it
 * became the number the app showed publishers as "your daily AI limit". Anyone
 * reasoning about why a scan stopped was reasoning about a figure we made up.
 *
 * The real ceilings come from the provider on every response it sends and are
 * recorded by recordLimits below, so the wall is now knowable without a number
 * standing in for it. `CLASSIFY_DAILY_QUOTA` remains for whoever wants a cost
 * brake — set it to a number to cap, or to 0 to switch classification off —
 * but unset means unset rather than 500.
 *
 * Hitting it is still not a failure: grades are remembered per photo on the
 * device, so a scan stopped here resumes where it left off.
 */
const DAILY_QUOTA = dailyQuotaFrom(Deno.env.get('CLASSIFY_DAILY_QUOTA'));

/**
 * Resolves the id whose quota this request spends, or null when the caller is
 * neither a signed-in user nor an attributable server call. See classifyCaller
 * for which callers exist and why the service-role key is one of them.
 */
async function authenticatedUserId(req: Request): Promise<string | null> {
  const caller = classifyCaller(
    req.headers.get('Authorization'),
    req.headers.get('x-publisher-id'),
    SERVICE_KEY,
  );
  if (caller.kind === 'rejected') return null;
  if (caller.kind === 'service') return caller.userId;
  try {
    const { data } = await admin.auth.getUser(caller.token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Added when the request carries a reference image, which arrives as the FIRST
 * image in the prompt — before the photos being graded. Spelled out that way
 * because the model is otherwise free to read the images in any order, and
 * getting it backwards would grade the publisher's profile photo and answer
 * about the wrong pictures entirely.
 *
 * The wording asks about one specific person — the one in the reference — and
 * never about who else is in the frame. Naming or recognising travel companions
 * is explicitly out of scope for issue #137.
 */
const REFERENCE_PROMPT = `The FIRST image is a reference portrait of one specific person.
It is NOT one of the photos being classified and gets no entry of its own. Every image
AFTER it is a photo to classify, and image index 0 means the first of those — not the
reference. The reference is used for one extra question per photo:

- contains_reference_person: true if the person from the reference portrait appears anywhere
  in that photo, false otherwise. Judge only that one person — ignore everyone else in
  the frame, and do not describe or identify anybody. Say false when you are unsure.
- reference_confidence: 0..1, how certain you are of that answer.

`;

const PROMPT = `You classify photos for a social "share my travels" app.

You are given N images to classify, in order. Grade EVERY one independently and
return one JSON entry per image, each carrying the 0-based "index" of the image
it grades. Return exactly N entries. Never merge, skip, or reorder them — an
entry whose index does not match the image it describes corrupts the publisher's
library.

For each image:

Choose exactly one category:
- selfie_with_view: one or more people in frame with a scenic/landscape background — selfie, posed, or candid alike.
- sunset_sunrise: dominant subject is a golden-hour, sunrise, or sunset sky (with or without people).
- architecture: buildings, bridges, streets, or urban scenes without focus on nature or people — including museums, temples, churches and historic sites.
- selfie_with_people: people are the subject — group shot, portrait, or candid; no notable scenery.
- food: a dish, drink, or meal is the primary subject.
- nature: forests, beaches, wildlife, plants — natural scenes where people are not the subject.
- night_scene: night photography, city lights, stars, or dark-sky shots.
- other: anything else — screenshots, documents, receipts, memes, blurry/unusable images.

Also rate:
- confidence: 0..1, how certain you are of the category.
- quality: 0..1, photographic quality (sharpness, exposure, composition; low for blurry/dark/cluttered).
- caption: a short, friendly caption (max ~8 words).
- scene: a 2-4 word kebab-case slug describing WHERE or WHAT — the primary location
  or subject of the photo, ignoring who is in it (e.g. "beach-sunset", "restaurant-dinner",
  "mountain-trail", "old-city-market"). Two photos of the same place MUST share the same
  slug. Prefer generic location terms over unique details so similar shots collide.
- reason: ONE short sentence (max 25 words) saying why THIS photo got THIS category and
  THIS quality — name what you actually saw. Be concrete and specific: "subject is
  motion-blurred and the horizon is tilted" or "crisp golden-hour light, clean
  composition, sharp on the couple". Never restate the scores back as words, never
  hedge, and never describe a photo you were not shown.

Respond with JSON only.`;

const BASE_PROPERTIES = {
  index: { type: 'INTEGER' },
  category: { type: 'STRING', enum: [...CATEGORIES] },
  confidence: { type: 'NUMBER' },
  quality: { type: 'NUMBER' },
  caption: { type: 'STRING' },
  scene: { type: 'STRING' },
  reason: { type: 'STRING' },
};
// `index` is required and load-bearing: see pairBatchResults for why a bare
// ordered array is not safe enough to attach a grade to a photo.
const BASE_REQUIRED = ['index', 'category', 'confidence', 'quality', 'caption', 'scene', 'reason'];

/**
 * One entry per photo, tagged with the index of the image it grades.
 *
 * The face fields are added only when a reference was sent. Requiring them
 * unconditionally would make the model answer a question it was shown nothing
 * for, and a hallucinated `true` here is a stranger's photo in somebody's post.
 */
function responseSchema(hasReference: boolean): Record<string, unknown> {
  const items = hasReference
    ? {
        type: 'OBJECT',
        properties: {
          ...BASE_PROPERTIES,
          contains_reference_person: { type: 'BOOLEAN' },
          reference_confidence: { type: 'NUMBER' },
        },
        required: [...BASE_REQUIRED, 'contains_reference_person', 'reference_confidence'],
      }
    : { type: 'OBJECT', properties: BASE_PROPERTIES, required: BASE_REQUIRED };
  return { type: 'ARRAY', items };
}

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

interface ImageInput {
  url?: string;
  base64?: string;
  mimeType?: string;
}

interface PhotoInput extends ImageInput {
  id: string;
}

async function resolveImage(photo: ImageInput): Promise<ResolvedImage> {
  if (photo.base64) {
    return { data: photo.base64, mimeType: photo.mimeType ?? 'image/jpeg' };
  }
  if (photo.url) {
    // Ask the CDN for a thumbnail rather than the original. Classification does
    // not need the pixels a post needs, and the smaller body is what makes a
    // batched request fit.
    const res = await fetch(downscaledUrl(photo.url));
    if (!res.ok) throw new Error(`fetch image failed (${res.status})`);
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { data: bytesToBase64(bytes), mimeType };
  }
  throw new Error('photo has neither url nor base64');
}

/**
 * Fetches the reference portrait once per request, or gives up on it.
 *
 * Deliberately soft: a profile photo behind a dead URL must not fail the whole
 * request. Every photo in it is still worth grading on category and quality —
 * the batch just loses the face preference for this run, which the ranking
 * already treats as "not known to contain them".
 */
async function resolveReference(reference: ImageInput | null): Promise<ResolvedImage | null> {
  if (reference == null) return null;
  try {
    return await resolveImage(reference);
  } catch (err) {
    console.warn('classify: reference image unreadable, continuing without it:', String(err));
    return null;
  }
}

/**
 * A Gemini call that did not produce a grade, with everything the caller needs
 * to decide whether waiting will help.
 */
/**
 * What to tell the app to wait when a provider rate-limits us without naming a
 * delay. Sized to a per-minute window: long enough that the retry has a chance,
 * short enough that a scan resumes rather than ending the day.
 */
const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 30;

/**
 * Every provider this function knows how to build, by name.
 *
 * Adding a vendor is an entry here plus a file implementing VisionProvider —
 * deliberately, because this has already changed twice and will change again. A
 * factory returns null when its key is absent, so an unconfigured provider is
 * skipped rather than exploding a chain that has a working one after it.
 */
const PROVIDERS: Record<string, () => VisionProvider | null> = {
  gemini: () => (GEMINI_API_KEY === '' ? null : geminiProvider(GEMINI_API_KEY, GEMINI_MODEL)),
  groq: () => (GROQ_API_KEY === '' ? null : groqProvider(GROQ_API_KEY)),
};

/**
 * The provider chain, in the order they should be tried.
 *
 * `VISION_PROVIDER` is a comma-separated list, not a single name: "groq,gemini"
 * means grade on Groq and fall back to Gemini when Groq is spent. Order is the
 * whole configuration — which vendor leads, and what catches it — so changing
 * strategy is a secret, never a deploy.
 *
 * Defaults to "groq,gemini" — see requestedProviders for why Gemini can no
 * longer lead.
 */
function providerChain(): VisionProvider[] {
  const requested = requestedProviders(Deno.env.get('VISION_PROVIDER'));

  const chain: VisionProvider[] = [];
  for (const name of requested) {
    const build = PROVIDERS[name];
    if (build == null) {
      console.warn(`classify: unknown VISION_PROVIDER "${name}", skipping`);
      continue;
    }
    const provider = build();
    // Named but keyless. Warned about rather than ignored: silently running on
    // the fallback looks exactly like the switch having worked.
    if (provider == null) {
      console.warn(`classify: provider "${name}" has no API key set, skipping`);
      continue;
    }
    chain.push(provider);
  }

  if (chain.length === 0) {
    throw new Error(
      `No usable vision provider: VISION_PROVIDER="${requested.join(',')}" and no matching API key is set`,
    );
  }
  return chain;
}

class ClassifyError extends Error {
  constructor(
    readonly photoId: string,
    message: string,
    readonly upstreamStatus?: number,
    /** Seconds Gemini asked us to wait, when it named one. */
    readonly retryAfterSeconds?: number | null,
    /** Gemini's per-day cap, which no wait short of tomorrow clears. */
    readonly dailyQuota?: boolean,
  ) {
    super(message);
    this.name = 'ClassifyError';
  }
}

/**
 * Grades a whole set of photos in ONE Gemini call.
 *
 * The images ride together in a single `contents` part list, in the order given,
 * and the model answers with one indexed entry each. That ordering is the only
 * thing tying a grade to a photo, so pairBatchResults verifies it rather than
 * trusting it — a grade attached to the wrong photo would be cached for months
 * and look exactly like a correct one.
 *
 * A photo the model skipped comes back in `missing` rather than as a guess.
 * That is the same principle the single-photo version established: a grade we
 * did not receive is never invented, because a fabricated `other`/quality-0
 * verdict silently retires a photo forever.
 *
 * The reference portrait, when there is one, leads the image list and is not
 * graded itself — so photo index 0 is the SECOND image in the request. That
 * offset is stated in REFERENCE_PROMPT and applied in pairBatchResults' input
 * here; the two must move together.
 */
/**
 * Grades as many of `photos` as one provider can, in calls of its own size.
 *
 * Returns what it managed plus whatever stopped it, rather than throwing: the
 * caller decides whether the next provider should pick up the remainder, and
 * that decision needs to see the failure.
 */
async function gradeWithProvider(
  provider: VisionProvider,
  photos: PhotoInput[],
  reference: ResolvedImage | null,
  prompt: string,
  schema: Record<string, unknown>,
): Promise<{
  classifications: Classification[];
  ungraded: PhotoInput[];
  failure: VisionFailure | null;
  /** The last thing this provider said about its own ceilings. */
  limits: ProviderLimits | null;
}> {
  // The reference rides in every call and counts against the provider's image
  // budget, so it is subtracted once here rather than remembered in each one.
  const perCall = Math.max(1, provider.maxImagesPerCall - (reference == null ? 0 : 1));
  const classifications: Classification[] = [];
  // Overwritten by each call, so this ends up holding the most recent reading —
  // which is the only one worth keeping: a limit is a current fact.
  let limits: ProviderLimits | null = null;

  for (let offset = 0; offset < photos.length; offset += perCall) {
    const slice = photos.slice(offset, offset + perCall);
    const images = await Promise.all(slice.map(resolveImage));

    const result = await provider.classify({ prompt, reference, images, responseSchema: schema });
    if (result.limits != null) limits = result.limits;
    if (!result.ok) {
      // Everything from this slice on is still ungraded. Handing it back whole
      // is what lets a fallback grade only the remainder instead of paying for
      // the photos this provider already answered.
      return { classifications, ungraded: photos.slice(offset), failure: result.failure, limits };
    }

    // Indices are per call, so each slice is paired against its own ids. A
    // provider that answered about the wrong picture is caught here rather than
    // cached for months looking correct.
    const { paired } = pairBatchResults(slice.map(p => p.id), result.entries);
    for (const { id, parsed } of paired) {
      classifications.push(parseClassification(id, parsed, reference != null));
    }
  }

  return { classifications, ungraded: [], failure: null, limits };
}

/**
 * Grades a whole set of photos, falling down the provider chain as needed.
 *
 * A provider that is out of budget for the day, unreachable, misconfigured or
 * broken hands the rest of the work to the next one — which is what makes a
 * small daily allowance useful as a safety net rather than as the main road.
 * A provider that is merely rate-limited for the minute does NOT: that clears
 * on its own, and burning the fallback on it wastes the thing being saved.
 *
 * A photo no provider answered for comes back in `missing` rather than as a
 * guess, exactly as before: a fabricated grade silently retires a photo.
 */
async function classifyBatch(
  photos: PhotoInput[],
  reference: ResolvedImage | null,
): Promise<{
  classifications: Classification[];
  missing: string[];
  limits: ProviderLimits | null;
}> {
  const chain = providerChain();
  const prompt = reference == null ? PROMPT : REFERENCE_PROMPT + PROMPT;
  const schema = responseSchema(reference != null);

  const classifications: Classification[] = [];
  let remaining = photos;
  let lastFailure: VisionFailure | null = null;
  let lastProvider = chain[0]?.name ?? 'none';
  let limits: ProviderLimits | null = null;

  for (const provider of chain) {
    if (remaining.length === 0) break;

    const result = await gradeWithProvider(provider, remaining, reference, prompt, schema);
    classifications.push(...result.classifications);
    remaining = result.ungraded;
    lastFailure = result.failure;
    lastProvider = provider.name;
    // The chain's *last* speaker wins. That is deliberate: if Groq was spent and
    // Gemini finished the batch, the ceiling that matters to the next request is
    // Gemini's, and reporting the leader's would describe a wall already passed.
    if (result.limits != null) limits = result.limits;

    if (result.failure == null) break;

    // Busy, not finished. Let the app wait rather than spending another
    // provider's budget on a pause that ends by itself.
    if (!isProviderExhausted(result.failure)) break;

    console.warn(
      `classify: ${provider.name} exhausted (${result.failure.status}), ` +
        `${remaining.length} photo(s) fall through to the next provider`,
    );
  }

  // Nothing at all came back and something went wrong: report it, so a spent
  // quota or a broken key surfaces as itself instead of as "no photos matched".
  if (classifications.length === 0 && lastFailure != null) {
    // Recorded before throwing. A refusal is often the most informative reading
    // there is — for Gemini it is the *only* one — and losing it to the error
    // path is how the real ceiling stayed invisible.
    await recordLimits(limits);
    throw new ClassifyError(
      photos[0]?.id ?? '',
      `${lastProvider} error (${lastFailure.status}): ${lastFailure.body}`,
      lastFailure.status,
      lastFailure.retryAfterSeconds,
      lastFailure.dailyQuota,
    );
  }

  return { classifications, missing: remaining.map(p => p.id), limits };
}

/**
 * Saves the provider's latest statement of its own ceilings.
 *
 * Best-effort by design: a classify request that graded photos must not fail
 * because a diagnostic write did. Failures are logged and swallowed — the same
 * bargain the quota counter makes.
 *
 * Written per request rather than sampled, because the numbers move per request
 * and the value of having them at all is that they are current. The table holds
 * one row per provider+model, so this is an overwrite, not growth.
 */
async function recordLimits(limits: ProviderLimits | null): Promise<void> {
  if (limits == null) return;
  const { error } = await admin.rpc('record_provider_limits', {
    p_provider: limits.provider,
    p_model: limits.model,
    p_request_limit: limits.requests?.limit ?? null,
    p_request_remaining: limits.requests?.remaining ?? null,
    p_request_reset_seconds: limits.requests?.resetSeconds ?? null,
    p_token_limit: limits.tokens?.limit ?? null,
    p_token_remaining: limits.tokens?.remaining ?? null,
    p_token_reset_seconds: limits.tokens?.resetSeconds ?? null,
  });
  if (error != null) console.warn('classify: could not record provider limits:', error.message);
}

/** Row shape of `provider_limits` — see migration 20240037. */
interface LimitsRow {
  provider: string;
  model: string;
  request_limit: number | null;
  request_remaining: number | null;
  request_reset_seconds: number | null;
  token_limit: number | null;
  token_remaining: number | null;
  token_reset_seconds: number | null;
  observed_at: string;
}

/**
 * The latest reading from EVERY provider that has ever answered, in the order
 * VISION_PROVIDER tries them.
 *
 * It used to return only the newest row, and the newest row is whichever
 * provider spoke last — which is the FALLBACK whenever the leader is spent. A
 * deployment configured `groq,gemini` therefore reported "gemini" to the app the
 * moment Groq's daily tokens ran out, so the chain's configuration and what the
 * screen said were both true and irreconcilable from the screen.
 *
 * Chain order, not observation order: the list is about how grading is
 * configured, and sorting by recency would reshuffle it every time a provider
 * answered. A provider that has never been heard from is simply absent.
 *
 * Null windows rather than zeros, all the way through: "we have not been told"
 * and "you have none left" are opposite facts, and the app renders them apart.
 */
async function readLimits(): Promise<ProviderLimits[]> {
  const { data, error } = await admin
    .from('provider_limits')
    .select('*')
    .order('observed_at', { ascending: false });
  if (error != null) {
    console.warn('classify: could not read provider limits:', error.message);
    return [];
  }

  const window = (limit: number | null, remaining: number | null, reset: number | null) =>
    limit == null || remaining == null ? null : { limit, remaining, resetSeconds: reset };

  const byProvider = new Map<string, ProviderLimits>();
  for (const row of (data as LimitsRow[] | null) ?? []) {
    // Rows arrive newest first, so the first one seen for a provider is its
    // latest reading — a provider that has switched models keeps only the
    // reading that still describes what it is answering as.
    if (byProvider.has(row.provider)) continue;
    byProvider.set(row.provider, {
      provider: row.provider,
      model: row.model,
      requests: window(row.request_limit, row.request_remaining, row.request_reset_seconds),
      tokens: window(row.token_limit, row.token_remaining, row.token_reset_seconds),
      observedAt: Date.parse(row.observed_at),
    });
  }

  const order = requestedProviders(Deno.env.get('VISION_PROVIDER'));
  const chain = order
    .map(name => byProvider.get(name))
    .filter((p): p is ProviderLimits => p != null);
  // Anything recorded by a provider no longer in the chain still gets reported,
  // after the configured ones: it is a real reading, and silently dropping it
  // would hide a provider that was answering until this morning.
  const extra = [...byProvider.values()].filter(p => !order.includes(p.provider));
  return [...chain, ...extra];
}

/**
 * GET /classify-photos — how much of the caller's daily budget is gone.
 *
 * Both numbers live here and nowhere else: the count is in a table only the
 * service role may read, and the ceiling is this function's own env var. Any
 * client-side version of either would be a guess.
 *
 * Reads through increment_classify_quota with an increment of zero rather than
 * selecting the row, so "today" is the database's `current_date` — the same
 * definition the enforcing path uses. A client (or this worker) deciding what
 * day it is could disagree with the DB by an hour and report a spent budget as
 * fresh, or the reverse.
 */
async function usageResponse(userId: string): Promise<Response> {
  const quota = await admin.rpc('increment_classify_quota', { p_user: userId, p_inc: 0 });
  if (quota.error != null) {
    console.error('classify usage read failed:', quota.error.message);
    return json({ error: 'Usage unavailable' }, 503);
  }
  // The RPC returns the count, not the date it counted for; asking the DB for
  // `current_date` separately would be a second round trip for a label. UTC is
  // what a Supabase database's `current_date` resolves to.
  const day = new Date().toISOString().slice(0, 10);
  // Read alongside our own count, because on their own neither is the answer:
  // ours says what this publisher spent, the provider's says what the account
  // may still spend, and only the second is a wall anybody actually hits.
  const providers = await readLimits();
  // `provider` is the singular field older app builds read. Kept as the chain's
  // LEADER rather than the last speaker, so even an un-updated build stops
  // naming the fallback as the thing doing the grading.
  return json({
    ...quotaSnapshot(quota.data, DAILY_QUOTA, day),
    provider: providers[0] ?? null,
    providers,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }
  // Any usable provider will do. This used to demand GEMINI_API_KEY
  // specifically, which 500s a deployment that grades on Groq and has no Gemini
  // key at all — the exact configuration `VISION_PROVIDER` exists to allow.
  if (!GEMINI_API_KEY && !GROQ_API_KEY) return json({ error: 'Server not configured' }, 500);

  // The anon key alone is not enough — a signed-in user must be behind the call.
  const userId = await authenticatedUserId(req);
  if (userId == null) return json({ error: 'Authentication required' }, 401);

  // Reporting the budget, not spending it. Above the body parse on purpose: a
  // GET has no body, and everything below this line is about photos.
  if (req.method === 'GET') return usageResponse(userId);

  let body: { photos?: PhotoInput[]; reference?: ImageInput | null };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length === 0) return json({ classifications: [] });
  if (photos.length > MAX_PHOTOS_PER_REQUEST) {
    return json({ error: `Too many photos per request (max ${MAX_PHOTOS_PER_REQUEST})` }, 400);
  }

  // Per-user daily count. Always incremented, even with no ceiling set: the
  // number is what the AI budget read-out reports, and it is the only per-user
  // record of spend that exists. Fails open on infra errors (logged) — a broken
  // counter must not take the feature down.
  const quota = await admin.rpc('increment_classify_quota', { p_user: userId, p_inc: photos.length });
  if (quota.error != null) {
    console.error('classify quota check failed:', quota.error.message);
  } else if (DAILY_QUOTA != null && typeof quota.data === 'number' && quota.data > DAILY_QUOTA) {
    console.warn(`classify quota exceeded: user ${userId} at ${quota.data}/${DAILY_QUOTA}`);
    const reason: RefusalReason = 'daily_quota';
    return json({ error: 'Daily classification quota exceeded', reason }, 429);
  }

  // The publisher's profile photo, when they asked for the face preference.
  // Fetched once for the whole request rather than per photo: it is the same
  // portrait for every photo in the body, and it is the only image here that
  // would otherwise be paid for more than once.
  const reference = await resolveReference(
    typeof body.reference === 'object' && body.reference !== null ? body.reference : null,
  );

  // Classify sequentially (called one photo at a time by the app) so a single
  // large batch never hits worker memory limits.
  //
  // A photo the model could not grade is an error, never a guess. This loop
  // used to swallow the failure and answer 200 with a synthetic
  // `other`/quality-0 grade, which is the worst possible shape: the app cached
  // the fake grade for months, `other` is excluded from the swap pool, and the
  // scan still reported "N of N analysed" — so one bad afternoon quietly cost
  // the publisher those photos forever, with nothing anywhere saying why.
  // Failing the request is the honest answer: the client surfaces it and
  // remembers nothing.
  let classifications: Classification[] = [];
  let observed: ProviderLimits | null = null;
  try {
    // One call for the whole request. `missing` is photos the model did not
    // answer for; they are simply absent from the response, so the caller
    // re-queues them rather than caching a grade nobody produced.
    const graded = await classifyBatch(photos, reference);
    classifications = graded.classifications;
    observed = graded.limits;
    // Recorded on the success path too, not only on refusal. Learning a ceiling
    // only from the 429 that enforced it means only ever learning it too late.
    await recordLimits(observed);
    if (graded.missing.length > 0) {
      console.warn(
        `classify: ${graded.missing.length}/${photos.length} photos ungraded in batch`,
      );
    }
  } catch (err) {
    const failure = err instanceof ClassifyError ? err : null;
    console.error('classify failed:', err);

    // An upstream 429 is Gemini's per-minute cap, NOT the day's budget — the
    // free tier allows 5 requests/minute per model, and although a request now
    // carries up to MAX_PHOTOS_PER_REQUEST photos for one slot, a big enough
    // scan still reaches it. It clears in about a minute, and is reported as its
    // own reason with the wait attached, so the app can pause and resume instead
    // of declaring the day over on the user's first attempt.
    // Gemini's per-day cap reads as `daily_quota`, the same as our own ceiling,
    // because it means the same thing to the app: stop, nothing today helps.
    // Reporting it as `rate_limited` with Gemini's own sub-minute RetryInfo is
    // what made a scan retry a budget that was already spent, until it gave up
    // — several more requests gone, and minutes on "Scanning your library".
    if (failure?.upstreamStatus === 429 && failure.dailyQuota === true) {
      const reason: RefusalReason = 'daily_quota';
      return json({ error: 'Gemini daily quota exhausted', reason, detail: failure.message }, 429);
    }

    if (failure?.upstreamStatus === 429) {
      const reason: RefusalReason = 'rate_limited';
      return json(
        {
          error: 'Classification rate limited',
          reason,
          retry_after_seconds: failure.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_RETRY_SECONDS,
          photo_id: failure.photoId,
          detail: failure.message,
        },
        429,
      );
    }

    return json(
      {
        error: 'Classification failed',
        photo_id: failure?.photoId ?? null,
        detail: failure?.message ?? String(err),
      },
      502,
    );
  }

  // `limits` rides back with the grades so a caller learns the account's real
  // remaining budget from the request that just spent some of it, rather than
  // having to ask separately (and spend another).
  return json({ classifications, limits: observed });
});
