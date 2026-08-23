/**
 * Supabase Edge Function: POST /classify-photos
 * Body: { "photos": [{ "id": string, "url"?: string, "base64"?: string, "mimeType"?: string }],
 *         "reference"?: { "url"?: string, "base64"?: string, "mimeType"?: string } }
 * Returns: { "classifications": [{ id, category, confidence, quality, caption, scene,
 *                                  contains_reference_person, reference_confidence }] }
 *
 * `reference` is the publisher's profile photo (issue #137). When it is present
 * each photo is additionally judged for whether that same person appears in it,
 * which is what the "photos of me" preference ranks and filters on. It is
 * optional and sent only by a publisher who turned that preference on: with no
 * reference the model is never shown a face to match and the two extra fields
 * come back false/0. Nothing about the reference is stored here — it is fetched
 * per request, used in one prompt, and forgotten.
 *
 * The single place provider specifics live. It holds GEMINI_API_KEY (never shipped
 * in the app) and asks Gemini Flash to classify each photo into one of the rule
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
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (optional, default gemini-3.5-flash),
 *      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  bytesToBase64,
  CATEGORIES,
  type Classification,
  classifyCaller,
  downscaledUrl,
  pairBatchResults,
  parseClassification,
  parseRetryDelaySeconds,
  type RefusalReason,
} from './logic.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
/**
 * Default model. NOT 2.0/2.5-flash: Google set their free-tier quota to
 * literally 0 ("limit: 0, model: gemini-2.0-flash"), so every call 429s
 * regardless of how little you have used — the model is paid-only now. A live
 * model with a working free tier is the only sane default; override with the
 * GEMINI_MODEL secret to pin a different one.
 */
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash';
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
 * Per-user photos per day. This is *our* ceiling, not Google's — Google's real
 * limit is per-account and only visible on the AI Studio rate-limit dashboard,
 * so this exists to stop a bug costing a fortune, not to mirror the API.
 *
 * Overridable via the CLASSIFY_DAILY_QUOTA secret precisely because the right
 * number depends on the account: tune it once the dashboard says what the plan
 * actually allows, without a redeploy of this file.
 *
 * Hitting it is not a failure — grades are remembered per photo on the device,
 * so a scan stopped here resumes where it left off instead of re-buying what
 * it already has.
 */
const DAILY_QUOTA = Number(Deno.env.get('CLASSIFY_DAILY_QUOTA') ?? '500') || 500;

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
- architecture: buildings, bridges, streets, or urban scenes without focus on nature or people.
- selfie_with_people: people are the subject — group shot, portrait, or candid; no notable scenery.
- food: a dish, drink, or meal is the primary subject.
- nature: forests, beaches, wildlife, plants — natural scenes where people are not the subject.
- night_scene: night photography, city lights, stars, or dark-sky shots.
- cultural: museums, art, religious or historical sites, traditions, or performances.
- other: anything else — screenshots, documents, receipts, memes, blurry/unusable images.

Also rate:
- confidence: 0..1, how certain you are of the category.
- quality: 0..1, photographic quality (sharpness, exposure, composition; low for blurry/dark/cluttered).
- caption: a short, friendly caption (max ~8 words).
- scene: a 2-4 word kebab-case slug describing WHERE or WHAT — the primary location
  or subject of the photo, ignoring who is in it (e.g. "beach-sunset", "restaurant-dinner",
  "mountain-trail", "old-city-market"). Two photos of the same place MUST share the same
  slug. Prefer generic location terms over unique details so similar shots collide.

Respond with JSON only.`;

const BASE_PROPERTIES = {
  index: { type: 'INTEGER' },
  category: { type: 'STRING', enum: [...CATEGORIES] },
  confidence: { type: 'NUMBER' },
  quality: { type: 'NUMBER' },
  caption: { type: 'STRING' },
  scene: { type: 'STRING' },
};
// `index` is required and load-bearing: see pairBatchResults for why a bare
// ordered array is not safe enough to attach a grade to a photo.
const BASE_REQUIRED = ['index', 'category', 'confidence', 'quality', 'caption', 'scene'];

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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

/** An image already in the shape Gemini wants it. */
interface ResolvedImage {
  data: string;
  mimeType: string;
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
interface GeminiFailure {
  status: number;
  body: string;
  /** From Gemini's own RetryInfo; null when it didn't say. */
  retryAfterSeconds: number | null;
}

type GeminiResult = { ok: true; payload: unknown } | { ok: false; failure: GeminiFailure };

/**
 * Longest wall Gemini can name that is still worth sitting out inside the
 * function. Beyond this the request is handed back to the app to retry, because
 * an Edge Function sleeping for half a minute is billed wall-clock time that
 * buys nothing the client can't do itself.
 */
const INLINE_RETRY_MAX_SECONDS = 2;

/** Attempts per Gemini call — one retry, and only when a retry can plausibly work. */
const GEMINI_ATTEMPTS = 2;

/**
 * What to tell the app to wait when Gemini rate-limits us without naming a
 * delay. Sized to the free tier's per-minute window: long enough that the retry
 * is not just another wasted request, short enough that the scan resumes while
 * the user is still watching it.
 */
const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 30;

/**
 * Calls Gemini, retrying only when retrying can actually succeed.
 *
 * The previous version retried EVERY 429 once, 800ms later. Against the free
 * tier's requests-per-minute cap that retry cannot succeed — the window is tens
 * of seconds wide — and it spends another request from the very budget that is
 * already exhausted, so a single throttled photo made the next one likelier to
 * fail too. Now a 429 is only re-sent when Gemini itself says the wait is
 * negligible; anything longer comes back with the delay attached.
 */
async function callGemini(body: string): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };

  let failure: GeminiFailure = { status: 0, body: 'no attempt made', retryAfterSeconds: null };

  for (let attempt = 1; attempt <= GEMINI_ATTEMPTS; attempt++) {
    const res = await fetch(url, request);
    if (res.ok) return { ok: true, payload: await res.json() };

    const text = await res.text().catch(() => '<unreadable body>');
    const retryAfterSeconds = res.status === 429 ? parseRetryDelaySeconds(text) : null;
    failure = { status: res.status, body: text, retryAfterSeconds };

    const worthRetrying =
      res.status >= 500 ||
      (res.status === 429 &&
        retryAfterSeconds != null &&
        retryAfterSeconds <= INLINE_RETRY_MAX_SECONDS);
    if (!worthRetrying || attempt === GEMINI_ATTEMPTS) break;

    await new Promise(resolve =>
      setTimeout(resolve, retryAfterSeconds != null ? retryAfterSeconds * 1000 : 800),
    );
  }

  return { ok: false, failure };
}

/**
 * A photo the model could not grade.
 *
 * Carries the upstream status so the handler can tell a spent Gemini quota —
 * nothing will work again today — from a broken call that is worth retrying
 * now. Flattening both into one opaque failure is what made "no more photos"
 * unexplainable.
 */
class ClassifyError extends Error {
  constructor(
    readonly photoId: string,
    message: string,
    readonly upstreamStatus?: number,
    /** Seconds Gemini asked us to wait, when it named one. */
    readonly retryAfterSeconds?: number | null,
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
async function classifyBatch(
  photos: PhotoInput[],
  reference: ResolvedImage | null,
): Promise<{ classifications: Classification[]; missing: string[] }> {
  const images = await Promise.all(photos.map(resolveImage));
  const parts = [
    { text: reference == null ? PROMPT : REFERENCE_PROMPT + PROMPT },
    ...(reference == null
      ? []
      : [{ inlineData: { mimeType: reference.mimeType, data: reference.data } }]),
    ...images.map(({ data, mimeType }) => ({ inlineData: { mimeType, data } })),
  ];

  const result = await callGemini(
    JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema(reference != null),
        temperature: 0,
      },
    }),
  );

  // The whole batch shares one call, so a refusal refuses all of it. The first
  // photo's id names the failure only so the error keeps its shape; the caller
  // reports the request, not the photo.
  if (!result.ok) {
    const { status, body, retryAfterSeconds } = result.failure;
    throw new ClassifyError(
      photos[0]?.id ?? '',
      `Gemini error (${status}): ${body}`,
      status,
      retryAfterSeconds,
    );
  }

  const payload = result.payload as
    | { candidates?: { content?: { parts?: { text?: unknown }[] } }[] }
    | null;
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    // Log the shape so an API format change is diagnosable from function logs.
    console.error('Gemini returned no content; payload shape:', JSON.stringify(payload)?.slice(0, 500));
    throw new ClassifyError(photos[0]?.id ?? '', 'Gemini returned no content');
  }

  const parsed = JSON.parse(text);
  const entries = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  const { paired, missing } = pairBatchResults(photos.map(p => p.id), entries);

  return {
    classifications: paired.map(({ id, parsed: entry }) =>
      parseClassification(id, entry, reference != null)),
    missing,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!GEMINI_API_KEY) return json({ error: 'Server not configured' }, 500);

  // The anon key alone is not enough — a signed-in user must be behind the call.
  const userId = await authenticatedUserId(req);
  if (userId == null) return json({ error: 'Authentication required' }, 401);

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

  // Per-user daily quota. Fails open on infra errors (logged) — a broken
  // counter must not take the feature down — but rejects over-quota users.
  const quota = await admin.rpc('increment_classify_quota', { p_user: userId, p_inc: photos.length });
  if (quota.error != null) {
    console.error('classify quota check failed:', quota.error.message);
  } else if (typeof quota.data === 'number' && quota.data > DAILY_QUOTA) {
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
  try {
    // One call for the whole request. `missing` is photos the model did not
    // answer for; they are simply absent from the response, so the caller
    // re-queues them rather than caching a grade nobody produced.
    const graded = await classifyBatch(photos, reference);
    classifications = graded.classifications;
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

  return json({ classifications });
});
