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

/** Guards against runaway clients: request size cap + per-user daily quota. */
const MAX_PHOTOS_PER_REQUEST = 3;
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
 * image in the prompt. Spelled out that way because the model is otherwise free
 * to read two images in either order, and getting it backwards would classify
 * the publisher's profile photo and answer about the wrong picture entirely.
 *
 * The wording asks about one specific person — the one in the reference — and
 * never about who else is in the frame. Naming or recognising travel companions
 * is explicitly out of scope for issue #137.
 */
const REFERENCE_PROMPT = `The FIRST image is a reference portrait of one specific person.
The SECOND image is the photo to classify. Every field below describes the SECOND image only;
the reference is used for one extra question and is not itself being classified.

- contains_reference_person: true if the person from the reference portrait appears anywhere
  in the second image, false otherwise. Judge only that one person — ignore everyone else in
  the frame, and do not describe or identify anybody. Say false when you are unsure.
- reference_confidence: 0..1, how certain you are of that answer.

`;

const PROMPT = `You classify a single photo for a social "share my travels" app.

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
  category: { type: 'STRING', enum: [...CATEGORIES] },
  confidence: { type: 'NUMBER' },
  quality: { type: 'NUMBER' },
  caption: { type: 'STRING' },
  scene: { type: 'STRING' },
};
const BASE_REQUIRED = ['category', 'confidence', 'quality', 'caption', 'scene'];

/**
 * The face fields are added to the schema only when a reference was sent.
 * Requiring them unconditionally would make the model answer a question it was
 * shown nothing for, and a hallucinated `true` here is a stranger's photo in
 * somebody's post.
 */
function responseSchema(hasReference: boolean): Record<string, unknown> {
  if (!hasReference) {
    return { type: 'OBJECT', properties: BASE_PROPERTIES, required: BASE_REQUIRED };
  }
  return {
    type: 'OBJECT',
    properties: {
      ...BASE_PROPERTIES,
      contains_reference_person: { type: 'BOOLEAN' },
      reference_confidence: { type: 'NUMBER' },
    },
    required: [...BASE_REQUIRED, 'contains_reference_person', 'reference_confidence'],
  };
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
    const res = await fetch(photo.url);
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

async function classifyOne(photo: PhotoInput, reference: ResolvedImage | null): Promise<Classification> {
  const { data, mimeType } = await resolveImage(photo);

  // Reference first, photo second — the order REFERENCE_PROMPT tells the model
  // to expect. Keep the two in step if either ever changes.
  const parts = reference == null
    ? [{ text: PROMPT }, { inlineData: { mimeType, data } }]
    : [
        { text: REFERENCE_PROMPT + PROMPT },
        { inlineData: { mimeType: reference.mimeType, data: reference.data } },
        { inlineData: { mimeType, data } },
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

  if (!result.ok) {
    const { status, body, retryAfterSeconds } = result.failure;
    throw new ClassifyError(photo.id, `Gemini error (${status}): ${body}`, status, retryAfterSeconds);
  }

  const payload = result.payload as
    | { candidates?: { content?: { parts?: { text?: unknown }[] } }[] }
    | null;
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    // Log the shape so an API format change is diagnosable from function logs.
    console.error('Gemini returned no content; payload shape:', JSON.stringify(payload)?.slice(0, 500));
    throw new ClassifyError(photo.id, 'Gemini returned no content');
  }
  return parseClassification(photo.id, JSON.parse(text), reference != null);
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
  const classifications: Classification[] = [];
  try {
    for (const photo of photos) {
      classifications.push(await classifyOne(photo, reference));
    }
  } catch (err) {
    const failure = err instanceof ClassifyError ? err : null;
    console.error('classify failed:', err);

    // An upstream 429 is Gemini's per-minute cap, NOT the day's budget — the
    // free tier allows 5 requests/minute per model and the app grades four
    // photos at a time, so a scan trips this within seconds of starting and is
    // usually fine again half a minute later. It is reported as its own reason,
    // with the wait attached, so the app can pause and resume instead of
    // declaring the day over on the user's first attempt.
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
