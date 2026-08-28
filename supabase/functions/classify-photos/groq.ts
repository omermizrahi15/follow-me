/**
 * Groq vision provider (OpenAI-compatible chat completions).
 *
 * Added because Gemini's free tier allows twenty requests a DAY per model, which
 * cannot grade a week of photos no matter how many are batched into each one.
 *
 * Two things differ from Gemini and both shape the code below:
 *
 * - Five images per call, not twelve. The caller chunks to `maxImagesPerCall`,
 *   so this is a number here rather than a rule anyone has to remember.
 * - JSON mode, not a schema. Groq guarantees the reply parses, not that it has
 *   the fields we asked for, so the shape is spelled out in the prompt and every
 *   entry still goes through the same validation Gemini's answers do. Nothing
 *   downstream trusts a provider to have got it right.
 */
import {
  entriesFrom,
  retryAfterHeader,
  type VisionProvider,
  type VisionRequest,
  type VisionResult,
} from './vision.ts';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Groq's vision model. Overridable, because the last provider taught us that a
 * model id is not a stable thing to hard-code.
 *
 * Read inside the factory rather than at module load: a module-level env read
 * makes the pure helpers in here untestable without granting the test suite
 * environment access, for a value only the factory ever needs.
 */
const DEFAULT_GROQ_MODEL = 'qwen/qwen3.6-27b';

/**
 * Documented ceiling for this model. The reference portrait counts towards it,
 * which is why the caller subtracts it rather than assuming five photos fit.
 *
 * Note that images per call is NOT what bounds this provider in practice.
 * Measured free-tier limits for qwen3.6-27b are 30 requests/minute and 1000/day
 * — generous — against 8k tokens/minute and 200k/day, which an image eats about
 * a thousand of. Tokens are the ceiling; the per-call image count only decides
 * how lumpily they are spent. See the usage logging in classify().
 */
const MAX_IMAGES_PER_CALL = 5;

/**
 * Appended when the provider cannot enforce a schema.
 *
 * JSON mode on OpenAI-compatible APIs generally refuses to return a top-level
 * array, so a wrapper object is requested explicitly instead of hoping for one.
 */
const SHAPE_INSTRUCTIONS = `
Return ONLY a JSON object of the form {"results": [ ... ]} with one entry per photo
to classify, each entry containing exactly these keys:
  "index" (integer, 0-based, identifying which photo the entry describes),
  "category" (string), "confidence" (number 0..1), "quality" (number 0..1),
  "caption" (string), "scene" (string)
Add no commentary outside the JSON.`;

const REFERENCE_SHAPE_INSTRUCTIONS = `
Each entry must ALSO contain "contains_reference_person" (boolean) and
"reference_confidence" (number 0..1).`;

/**
 * True when a Groq 429 is a per-day ceiling rather than a per-minute one.
 *
 * Groq names the window in the message ("Limit 14400, ... per day"), so the
 * period is read from the text. Anything not positively identified as daily
 * stays per-minute, matching the Gemini side: a needless minute of waiting is
 * cheap, and calling a recoverable pause a dead day retires a working scan.
 */
export function isGroqDailyLimit(body: string): boolean {
  return /per\s*day|requests?\s*per\s*day|\bRPD\b/i.test(body);
}

/** Seconds from Groq's prose ("Please try again in 7.2s"), or null. */
export function parseGroqRetrySeconds(body: string): number | null {
  const match = /try again in ([\d.]+)\s*(ms|s)\b/i.exec(body);
  if (match == null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  return match[2].toLowerCase() === 'ms' ? Math.ceil(value / 1000) : Math.ceil(value);
}

export function groqProvider(apiKey: string): VisionProvider {
  const model = Deno.env.get('GROQ_MODEL') ?? DEFAULT_GROQ_MODEL;
  return {
    name: 'groq',
    maxImagesPerCall: MAX_IMAGES_PER_CALL,
    enforcesSchema: false,

    async classify({ prompt, reference, images }: VisionRequest): Promise<VisionResult> {
      const instructions =
        prompt +
        SHAPE_INSTRUCTIONS +
        (reference == null ? '' : REFERENCE_SHAPE_INSTRUCTIONS);

      // Reference first when present — the same ordering the prompt describes,
      // so photo index 0 is the image after it.
      const content = [
        { type: 'text', text: instructions },
        ...(reference == null
          ? []
          : [{
            type: 'image_url',
            image_url: { url: `data:${reference.mimeType};base64,${reference.data}` },
          }]),
        ...images.map(({ mimeType, data }) => ({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${data}` },
        })),
      ];

      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content }],
            response_format: { type: 'json_object' },
            temperature: 0,
          }),
        });
      } catch (err) {
        return {
          ok: false,
          failure: {
            status: 0,
            body: `groq unreachable: ${String(err)}`,
            retryAfterSeconds: null,
            dailyQuota: false,
          },
        };
      }

      const text = await res.text().catch(() => '<unreadable body>');
      if (!res.ok) {
        return {
          ok: false,
          failure: {
            status: res.status,
            body: text,
            retryAfterSeconds: retryAfterHeader(res.headers) ?? parseGroqRetrySeconds(text),
            dailyQuota: res.status === 429 && isGroqDailyLimit(text),
          },
        };
      }

      // A 200 whose content will not parse is a provider failure, not a batch of
      // ungraded photos: reporting it as "the model skipped them" would cache
      // nothing and silently retire the request.
      try {
        const payload = JSON.parse(text) as {
          choices?: { message?: { content?: unknown } }[];
          usage?: { prompt_tokens?: number; total_tokens?: number };
        };

        // Logged because tokens, not requests, are what actually bounds this
        // provider: 8k a minute and 200k a day against ~1k for a single image.
        // The cost per photo decides the image width and the batch size, and
        // guessing at it is how the last provider's ceiling went unnoticed —
        // so the number comes from the API rather than from arithmetic.
        const total = payload.usage?.total_tokens;
        if (typeof total === 'number' && images.length > 0) {
          console.log(
            `groq usage: ${total} tokens for ${images.length} image(s)` +
              `${reference == null ? '' : ' + reference'}` +
              ` (~${Math.round(total / images.length)}/image)`,
          );
        }

        const raw = payload.choices?.[0]?.message?.content;
        if (typeof raw !== 'string') {
          return {
            ok: false,
            failure: {
              status: res.status,
              body: `groq returned no message content: ${text.slice(0, 300)}`,
              retryAfterSeconds: null,
              dailyQuota: false,
            },
          };
        }
        return { ok: true, entries: entriesFrom(JSON.parse(raw)) };
      } catch (err) {
        return {
          ok: false,
          failure: {
            status: res.status,
            body: `groq returned unparseable JSON (${String(err)}): ${text.slice(0, 300)}`,
            retryAfterSeconds: null,
            dailyQuota: false,
          },
        };
      }
    },
  };
}
