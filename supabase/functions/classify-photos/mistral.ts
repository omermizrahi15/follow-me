/**
 * Mistral vision provider (OpenAI-compatible chat completions).
 *
 * The default model is chosen from measured limits on a free key (2026-11-03):
 * ministral-14b ~937k tokens/min and 30 req/min; mistral-small and
 * mistral-medium answered 429 with a limit of 0. Re-check before changing it.
 *
 * Added because Groq's free tier caps input at ~7k tokens a MINUTE, which is
 * about one call a minute for this workload (issue #234). Mistral's free
 * "Experiment" plan meters differently; the live figures are on the Limits page
 * of the Mistral console, so they are not hard-coded here.
 */
import { openAiCompatibleProvider } from './groq.ts';
import type { VisionProvider } from './vision.ts';

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

/** Overridable via MISTRAL_MODEL: model ids are not a stable thing to hard-code. */
const DEFAULT_MISTRAL_MODEL = 'ministral-14b-latest';

export function mistralProvider(apiKey: string): VisionProvider {
  return openAiCompatibleProvider({
    name: 'mistral',
    endpoint: ENDPOINT,
    apiKey,
    model: Deno.env.get('MISTRAL_MODEL') ?? DEFAULT_MISTRAL_MODEL,
    maxImagesPerCall: 8,
  });
}
