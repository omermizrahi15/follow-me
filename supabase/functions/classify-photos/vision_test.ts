import { assert, assertEquals } from '@std/assert';
import { entriesFrom, isProviderExhausted, retryAfterHeader } from './vision.ts';
import { isGroqDailyLimit, parseGroqRetrySeconds } from './groq.ts';

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
