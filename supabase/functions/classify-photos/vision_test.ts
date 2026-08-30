import { assert, assertEquals } from '@std/assert';
import {
  entriesFrom,
  isProviderExhausted,
  parseDurationSeconds,
  rateLimitFromHeaders,
  retryAfterHeader,
} from './vision.ts';
import { isGroqDailyLimit, parseGroqRetrySeconds } from './groq.ts';
import { geminiQuotaLimits } from './gemini.ts';

Deno.test('entriesFrom — a bare array is what a schema-enforcing provider returns', () => {
  assertEquals(entriesFrom([{ index: 0 }, { index: 1 }]), [{ index: 0 }, { index: 1 }]);
});

Deno.test('entriesFrom — unwraps the object a JSON-mode provider has to return', () => {
  // OpenAI-compatible JSON mode generally refuses a top-level array, so the
  // prompt asks for {"results": [...]}.
  assertEquals(entriesFrom({ results: [{ index: 0 }] }), [{ index: 0 }]);
});

Deno.test('entriesFrom — tolerates the other names models reach for', () => {
  // The shape is prompt-enforced, not schema-enforced, so a model is free to
  // pick a synonym. Refusing one would discard a batch that graded correctly.
  assertEquals(entriesFrom({ classifications: [{ index: 1 }] }), [{ index: 1 }]);
  assertEquals(entriesFrom({ photos: [{ index: 2 }] }), [{ index: 2 }]);
});

Deno.test('entriesFrom — anything unrecognised grades nothing rather than guessing', () => {
  // Every photo then comes back as missing and is retried. Inventing entries
  // here would cache fabricated grades, which retires photos permanently.
  assertEquals(entriesFrom({}), []);
  assertEquals(entriesFrom(null), []);
  assertEquals(entriesFrom('surprise'), []);
  assertEquals(entriesFrom({ results: 'not an array' }), []);
});

Deno.test('retryAfterHeader — reads the header OpenAI-compatible providers use', () => {
  assertEquals(retryAfterHeader(new Headers({ 'retry-after': '7' })), 7);
  assertEquals(retryAfterHeader(new Headers({ 'retry-after': '7.2' })), 8);
});

Deno.test('retryAfterHeader — absent or nonsense means "no delay named"', () => {
  assertEquals(retryAfterHeader(new Headers()), null);
  assertEquals(retryAfterHeader(new Headers({ 'retry-after': 'soon' })), null);
});

Deno.test('parseGroqRetrySeconds — reads the delay out of Groq prose', () => {
  assertEquals(
    parseGroqRetrySeconds('Rate limit reached. Please try again in 7.2s'),
    8,
  );
  // Sub-second delays are reported in milliseconds and must not round to zero.
  assertEquals(parseGroqRetrySeconds('Please try again in 430ms'), 1);
  assertEquals(parseGroqRetrySeconds('no delay mentioned'), null);
});

Deno.test('isGroqDailyLimit — a daily ceiling is not something to wait out', () => {
  // Same trap as Gemini: both walls are 429 with a short retry delay attached.
  assert(isGroqDailyLimit('Rate limit reached for model, limit 14400 requests per day'));
  assert(isGroqDailyLimit('RPD exceeded'));
});

Deno.test('isGroqDailyLimit — a per-minute limit stays recoverable', () => {
  assertEquals(isGroqDailyLimit('Limit 30 requests per minute, try again in 2s'), false);
  assertEquals(isGroqDailyLimit('tokens per minute exceeded'), false);
});

const failure = (over: Partial<import('./vision.ts').VisionFailure> = {}) => ({
  status: 500,
  body: '',
  retryAfterSeconds: null,
  dailyQuota: false,
  ...over,
});

Deno.test('isProviderExhausted — a spent daily budget hands over to the next provider', () => {
  // The whole point of the chain: a 20/day allowance is a safety net, and the
  // net is only useful once the main provider is actually finished.
  assert(isProviderExhausted(failure({ status: 429, dailyQuota: true })));
});

Deno.test('isProviderExhausted — a per-minute limit does NOT hand over', () => {
  // It clears on its own in seconds. Spending a scarce fallback budget on a
  // pause that would have ended by itself uses up the net before it is needed.
  assertEquals(
    isProviderExhausted(failure({ status: 429, dailyQuota: false, retryAfterSeconds: 28 })),
    false,
  );
});

Deno.test('isProviderExhausted — unreachable, unauthorised and broken all hand over', () => {
  assert(isProviderExhausted(failure({ status: 0 })));        // never completed
  assert(isProviderExhausted(failure({ status: 401 })));      // bad key
  assert(isProviderExhausted(failure({ status: 403 })));
  assert(isProviderExhausted(failure({ status: 503 })));      // vendor down
  // A refused request may well be accepted by a vendor with different limits.
  assert(isProviderExhausted(failure({ status: 400 })));
});

Deno.test('isProviderExhausted — anything unrecognised stays put', () => {
  // Falling through on everything would make the fallback the main road by
  // accident, quietly draining the provider being held in reserve.
  assertEquals(isProviderExhausted(failure({ status: 404 })), false);
  assertEquals(isProviderExhausted(failure({ status: 418 })), false);
});

// ── The provider's own limits ───────────────────────────────────────────────
//
// Everything below exists because the number the app showed publishers — 500
// photos a day — was invented by us and matched nothing. The provider states
// its real ceilings on every single response; these read them.

Deno.test('parseDurationSeconds — the compound form Groq answers with', () => {
  assertEquals(parseDurationSeconds('2m59.56s'), 180);
  assertEquals(parseDurationSeconds('1h2m3s'), 3723);
});

Deno.test('parseDurationSeconds — plain seconds, rounded up', () => {
  assertEquals(parseDurationSeconds('7.66s'), 8);
  assertEquals(parseDurationSeconds('60'), 60);
});

Deno.test('parseDurationSeconds — sub-second waits still count as a wait', () => {
  // Zero would read as "the window is already open", which it is not.
  assertEquals(parseDurationSeconds('120ms'), 1);
});

Deno.test('parseDurationSeconds — nonsense is "the provider did not say"', () => {
  assertEquals(parseDurationSeconds(''), null);
  assertEquals(parseDurationSeconds('soon'), null);
  assertEquals(parseDurationSeconds(null), null);
});

Deno.test('rateLimitFromHeaders — reads both ceilings a vision call spends', () => {
  const limits = rateLimitFromHeaders(
    new Headers({
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-requests': '994',
      'x-ratelimit-reset-requests': '2m59.56s',
      'x-ratelimit-limit-tokens': '8000',
      'x-ratelimit-remaining-tokens': '2450',
      'x-ratelimit-reset-tokens': '41.5s',
    }),
    'groq',
    'qwen/qwen3.6-27b',
    1_700_000_000_000,
  );

  assertEquals(limits, {
    provider: 'groq',
    model: 'qwen/qwen3.6-27b',
    requests: { limit: 1000, remaining: 994, resetSeconds: 180 },
    tokens: { limit: 8000, remaining: 2450, resetSeconds: 42 },
    observedAt: 1_700_000_000_000,
  });
});

Deno.test('rateLimitFromHeaders — one ceiling reported without the other', () => {
  // Tokens are what actually bound an image workload, so a reply that names
  // only those is still worth every bit of what it says.
  const limits = rateLimitFromHeaders(
    new Headers({ 'x-ratelimit-limit-tokens': '200000', 'x-ratelimit-remaining-tokens': '199000' }),
    'groq',
    'm',
    1,
  );
  assertEquals(limits?.requests, null);
  assertEquals(limits?.tokens, { limit: 200000, remaining: 199000, resetSeconds: null });
});

Deno.test('rateLimitFromHeaders — a provider that states nothing yields nothing', () => {
  // Never a zeroed-out shape: "0 of 0 left" is a wall, and inventing one here
  // would be the same lie as the 500 this replaced.
  assertEquals(rateLimitFromHeaders(new Headers(), 'gemini', 'gemini-3.5-flash', 1), null);
});

Deno.test('rateLimitFromHeaders — unreadable numbers are dropped, not guessed at', () => {
  assertEquals(
    rateLimitFromHeaders(new Headers({ 'x-ratelimit-limit-requests': 'lots' }), 'groq', 'm', 1),
    null,
  );
});

Deno.test('geminiQuotaLimits — the ceiling Google names in its own refusal', () => {
  // Gemini sends no x-ratelimit headers at all; the only place it ever states a
  // number is the QuotaFailure inside a 429. Reading it is how "20 a day" stops
  // being folklore in a code comment and becomes something the app can show.
  const body = JSON.stringify({
    error: {
      code: 429,
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
              quotaValue: '20',
            },
          ],
        },
      ],
    },
  });

  assertEquals(geminiQuotaLimits(body, 'gemini-3.5-flash', 5), {
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    // Named in the refusal, so by definition none of it is left.
    requests: { limit: 20, remaining: 0, resetSeconds: null },
    tokens: null,
    observedAt: 5,
  });
});

Deno.test('geminiQuotaLimits — a per-minute violation keeps its own reset', () => {
  const body = JSON.stringify({
    error: {
      details: [
        {
          violations: [{
            quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
            quotaValue: '5',
          }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '38s' },
      ],
    },
  });
  assertEquals(geminiQuotaLimits(body, 'm', 1)?.requests, {
    limit: 5,
    remaining: 0,
    resetSeconds: 38,
  });
});

Deno.test('geminiQuotaLimits — anything that is not a quota refusal says nothing', () => {
  assertEquals(geminiQuotaLimits('not json', 'm', 1), null);
  assertEquals(geminiQuotaLimits(JSON.stringify({ error: { code: 500 } }), 'm', 1), null);
});
