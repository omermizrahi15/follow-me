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
              failure: {
                status: res.status,
                body: 'gemini returned no text part',
                retryAfterSeconds: null,
                dailyQuota: false,
              },
            };
          }
          try {
            return { ok: true, entries: entriesFrom(JSON.parse(text)) };
          } catch (err) {
            return {
              ok: false,
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

      return { ok: false, failure };
    },
  };
}
