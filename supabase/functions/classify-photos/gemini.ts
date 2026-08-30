/**
 * Gemini vision provider.
 *
 * The original implementation, moved behind the VisionProvider seam unchanged in
 * behaviour. It stays the default: it is the one whose grading has actually been
 * checked against real photos, and its schema enforcement means a reply either
 * has the fields or is not a reply at all.
 *
 * Its problem is quota, not quality — twenty requests a day on the free tier —
 * which is what the seam exists to route around.
 */
import { isDailyQuotaError, parseRetryDelaySeconds } from './logic.ts';
import {
  entriesFrom,
  type ProviderLimits,
  type VisionProvider,
  type VisionRequest,
  type VisionResult,
} from './vision.ts';

/**
 * Images per call. Comfortably under the 20MB inline payload limit at the width
 * these are downscaled to, and bounded so one refusal cannot cost the whole scan.
 */
const MAX_IMAGES_PER_CALL = 13;

/** Attempts per call — one retry, and only when a retry can plausibly work. */
const GEMINI_ATTEMPTS = 2;

/**
 * Longest delay worth sleeping through inside the request.
 *
 * Anything longer is handed back to the app, which can wait without holding an
 * edge function open. A per-day ceiling is never waited on at all.
 */
const INLINE_RETRY_MAX_SECONDS = 2;

/**
 * The ceiling Gemini names inside its own 429, as a ProviderLimits.
 *
 * Gemini sends no `x-ratelimit-*` headers — the single place it ever states a
 * number is the QuotaFailure attached to a refusal. So unlike a header-based
 * provider, this is knowable only once the wall has been hit, and `remaining`
 * is 0 by definition: it was reported because there was nothing left.
 *
 * Reading it is what turns "3.5-flash allows twenty a day" from folklore in a
 * code comment into a figure the app can show, sourced from Google rather than
 * from us.
 */
export function geminiQuotaLimits(
  body: string,
  model: string,
  observedAt: number,
): ProviderLimits | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const details = (parsed as { error?: { details?: unknown[] } })?.error?.details;
  if (!Array.isArray(details)) return null;

  let limit: number | null = null;
  for (const detail of details) {
    const violations = (detail as { violations?: unknown[] })?.violations;
    if (!Array.isArray(violations)) continue;
    for (const violation of violations) {
      const value = Number((violation as { quotaValue?: unknown })?.quotaValue);
      // The smallest ceiling named is the one actually stopping us: a reply can
      // cite the per-minute and per-day quotas at once, and reporting the
      // roomier of the two would describe a wall nobody hit.
      if (Number.isFinite(value) && (limit == null || value < limit)) limit = value;
    }
  }
  if (limit == null) return null;

  return {
    provider: 'gemini',
    model,
    requests: { limit, remaining: 0, resetSeconds: parseRetryDelaySeconds(body) },
    // Gemini states no token allowance anywhere in a refusal.
    tokens: null,
    observedAt,
  };
}

export function geminiProvider(apiKey: string, model: string): VisionProvider {
  return {
    name: 'gemini',
    maxImagesPerCall: MAX_IMAGES_PER_CALL,
    enforcesSchema: true,

    async classify(
      { prompt, reference, images, responseSchema }: VisionRequest,
    ): Promise<VisionResult> {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      // Reference first when present — the ordering the prompt describes, so
      // photo index 0 is the image after it.
      const parts = [
        { text: prompt },
        ...(reference == null
          ? []
          : [{ inlineData: { mimeType: reference.mimeType, data: reference.data } }]),
        ...images.map(({ data, mimeType }) => ({ inlineData: { mimeType, data } })),
      ];

      const body = JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          ...(responseSchema != null ? { responseSchema } : {}),
          temperature: 0,
        },
      });

      let failure = {
        status: 0,
        body: 'no attempt made',
        retryAfterSeconds: null as number | null,
        dailyQuota: false,
      };

      for (let attempt = 1; attempt <= GEMINI_ATTEMPTS; attempt++) {
        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          });
        } catch (err) {
          failure = {
            status: 0,
            body: `gemini unreachable: ${String(err)}`,
            retryAfterSeconds: null,
            dailyQuota: false,
          };
          break;
        }

        if (res.ok) {
          const payload = await res.json() as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
          };
          const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof text !== 'string') {
            return {
              ok: false,
              limits: null,
              failure: {
                status: res.status,
                body: 'gemini returned no text part',
                retryAfterSeconds: null,
                dailyQuota: false,
              },
            };
          }
          try {
            // A success teaches nothing about the ceiling here: Gemini only
            // ever names it in a refusal.
            return { ok: true, entries: entriesFrom(JSON.parse(text)), limits: null };
          } catch (err) {
            return {
              ok: false,
              limits: null,
              failure: {
                status: res.status,
                body: `gemini returned unparseable JSON (${String(err)})`,
                retryAfterSeconds: null,
                dailyQuota: false,
              },
            };
          }
        }

        const text = await res.text().catch(() => '<unreadable body>');
        const retryAfterSeconds = res.status === 429 ? parseRetryDelaySeconds(text) : null;
        // Google attaches a sub-minute RetryInfo to the per-day cap too, so the
        // delay alone cannot tell the two apart — the quotaId can.
        const dailyQuota = res.status === 429 && isDailyQuotaError(text);
        failure = { status: res.status, body: text, retryAfterSeconds, dailyQuota };

        const worthRetrying = res.status >= 500 ||
          (res.status === 429 &&
            !dailyQuota &&
            retryAfterSeconds != null &&
            retryAfterSeconds <= INLINE_RETRY_MAX_SECONDS);
        if (!worthRetrying || attempt === GEMINI_ATTEMPTS) break;

        await new Promise(resolve =>
          setTimeout(resolve, retryAfterSeconds != null ? retryAfterSeconds * 1000 : 800)
        );
      }

      // A refusal is the only moment Gemini states its ceiling, so the parse
      // happens here rather than per-attempt: `failure` holds the last body.
      const limits = failure.status === 429
        ? geminiQuotaLimits(failure.body, model, Date.now())
        : null;
      return { ok: false, failure, limits };
    },
  };
}
