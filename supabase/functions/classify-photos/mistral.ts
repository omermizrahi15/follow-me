/**
 * Mistral vision provider (OpenAI-compatible chat completions).
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
const DEFAULT_MISTRAL_MODEL = 'mistral-small-latest';

export function mistralProvider(apiKey: string): VisionProvider {
  return openAiCompatibleProvider({
    name: 'mistral',
    endpoint: ENDPOINT,
    apiKey,
    model: Deno.env.get('MISTRAL_MODEL') ?? DEFAULT_MISTRAL_MODEL,
    maxImagesPerCall: 8,
  });
}
