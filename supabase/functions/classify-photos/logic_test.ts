import { assert, assertEquals, assertThrows } from '@std/assert';
import {
  asCategory,
  bytesToBase64,
  clamp01,
  classifyCaller,
  parseClassification,
  CLASSIFY_IMAGE_WIDTH,
  downscaledUrl,
  isDailyQuotaError,
  pairBatchResults,
  parseRetryDelaySeconds,
} from './logic.ts';

// The exact body staging logged when the AI photo suggestion reported "daily
// limit reached" on the first attempt of the day (issue #141). It is a
// per-MINUTE ceiling of 5 requests that clears in under half a minute, which
// is why reading the delay off it matters more than the status code.
const GEMINI_RATE_LIMIT_BODY = JSON.stringify({
  error: {
    code: 429,
    message:
      'You exceeded your current quota. * Quota exceeded for metric: ' +
      'generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, ' +
      'model: gemini-3.5-flash\nPlease retry in 28.530505825s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '28s' },
    ],
  },
});

Deno.test('parseRetryDelaySeconds — reads the delay from a real Gemini 429', () => {
  assertEquals(parseRetryDelaySeconds(GEMINI_RATE_LIMIT_BODY), 28);
});

Deno.test('parseRetryDelaySeconds — falls back to the prose when RetryInfo is absent', () => {
  const body = JSON.stringify({ error: { message: 'Please retry in 12.4s.' } });
  // Rounded up: waking a moment early just spends another request on a wall
  // that has not lifted yet.
  assertEquals(parseRetryDelaySeconds(body), 13);
});

Deno.test('parseRetryDelaySeconds — null when nothing says how long to wait', () => {
  assertEquals(parseRetryDelaySeconds(JSON.stringify({ error: { message: 'slow down' } })), null);
  assertEquals(parseRetryDelaySeconds('not json at all'), null);
  assertEquals(parseRetryDelaySeconds(''), null);
});

Deno.test('clamp01 — clamps to [0,1] and defaults non-finite input to 0', () => {
  assertEquals(clamp01(0.5), 0.5);
  assertEquals(clamp01(-2), 0);
  assertEquals(clamp01(5), 1);
  assertEquals(clamp01('0.3'), 0.3); // string coercion
  assertEquals(clamp01('nope'), 0);
  assertEquals(clamp01(undefined), 0);
  assertEquals(clamp01(NaN), 0);
});

Deno.test('asCategory — passes known categories through, rejects anything else', () => {
  assertEquals(asCategory('food'), 'food');
  assertEquals(asCategory('sunset_sunrise'), 'sunset_sunrise');
  // 'other' is a real answer the model gives on purpose, not a fallback.
  assertEquals(asCategory('other'), 'other');
  assertEquals(asCategory('banana'), null);
  assertEquals(asCategory(42), null);
  assertEquals(asCategory(null), null);
});

Deno.test('bytesToBase64 — round-trips through atob', () => {
  const bytes = new TextEncoder().encode('hello world');
  assertEquals(bytesToBase64(bytes), btoa('hello world'));
});

Deno.test('bytesToBase64 — handles data larger than the 0x8000 chunk', () => {
  const big = new Uint8Array(0x8000 * 2 + 5).fill(65); // 'A'
  const decoded = atob(bytesToBase64(big));
  assertEquals(decoded.length, big.length);
  assert([...decoded].every((c) => c === 'A'));
});

Deno.test('parseClassification — normalizes a well-formed model response', () => {
  const c = parseClassification('id1', {
    category: 'nature',
    confidence: 0.9,
    quality: 0.7,
    caption: 'A forest trail',
    scene: 'Mountain-Trail',
  });
  assertEquals(c, {
    id: 'id1',
    category: 'nature',
    confidence: 0.9,
    quality: 0.7,
    caption: 'A forest trail',
    scene: 'mountain-trail', // lowercased + trimmed
    // No reference image went out with the request, so the face question was
    // never asked and must not read as "the publisher isn't in this photo".
    contains_reference_person: false,
    reference_confidence: 0,
  });
});

Deno.test('parseClassification — defaults junk scores and text, keeping the stated category', () => {
  const c = parseClassification('id2', { category: 'other', confidence: 5, quality: 'x', caption: 123 });
  assertEquals(c, {
    id: 'id2', category: 'other', confidence: 1, quality: 0, caption: '', scene: '',
    contains_reference_person: false, reference_confidence: 0,
  });
});

Deno.test('parseClassification — throws on an unknown category rather than inventing other', () => {
  // A fabricated `other` is indistinguishable from a real one on the device,
  // is excluded from the swap pool, and is cached for months — so a broken
  // model contract has to fail loudly here instead of being smoothed over.
  assertThrows(
    () => parseClassification('id3', { category: 'weird', confidence: 0.5, quality: 0.5 }),
    Error,
    'unknown category',
  );
  assertThrows(() => parseClassification('id4', {}), Error, 'unknown category');
});

const SERVICE_KEY = 'service-role-key';

Deno.test('classifyCaller — the app\'s JWT is passed through for verification', () => {
  assertEquals(classifyCaller('Bearer user-jwt', null, SERVICE_KEY), {
    kind: 'user-token',
    token: 'user-jwt',
  });
  // Case-insensitive scheme, and a bare token (no scheme) still counts.
  assertEquals(classifyCaller('bearer user-jwt', null, SERVICE_KEY), {
    kind: 'user-token',
    token: 'user-jwt',
  });
  assertEquals(classifyCaller('user-jwt', null, SERVICE_KEY), {
    kind: 'user-token',
    token: 'user-jwt',
  });
});

// The regression this branch fixes: auto-post has only the service-role key on a
// cron tick, and being rejected here took the whole autonomous push down.
Deno.test('classifyCaller — the service-role key is a server call, charged to the named publisher', () => {
  assertEquals(classifyCaller(`Bearer ${SERVICE_KEY}`, 'pub-1', SERVICE_KEY), {
    kind: 'service',
    userId: 'pub-1',
  });
});

Deno.test('classifyCaller — a service call that names nobody is rejected, not exempted', () => {
  assertEquals(classifyCaller(`Bearer ${SERVICE_KEY}`, null, SERVICE_KEY), { kind: 'rejected' });
  assertEquals(classifyCaller(`Bearer ${SERVICE_KEY}`, '', SERVICE_KEY), { kind: 'rejected' });
  assertEquals(classifyCaller(`Bearer ${SERVICE_KEY}`, '   ', SERVICE_KEY), { kind: 'rejected' });
});

Deno.test('classifyCaller — no Authorization header at all is rejected', () => {
  assertEquals(classifyCaller(null, 'pub-1', SERVICE_KEY), { kind: 'rejected' });
  assertEquals(classifyCaller('', 'pub-1', SERVICE_KEY), { kind: 'rejected' });
  assertEquals(classifyCaller('Bearer ', 'pub-1', SERVICE_KEY), { kind: 'rejected' });
});

// An unset SUPABASE_SERVICE_ROLE_KEY must not turn `x-publisher-id` into a way
// to impersonate anyone by sending an empty-ish token.
Deno.test('classifyCaller — an unconfigured service key never matches', () => {
  assertEquals(classifyCaller('Bearer anything', 'pub-1', ''), {
    kind: 'user-token',
    token: 'anything',
  });
  assertEquals(classifyCaller('Bearer ', 'pub-1', ''), { kind: 'rejected' });
});

// --- downscaledUrl ----------------------------------------------------------

Deno.test('downscaledUrl — inserts a width-limited transformation', () => {
  assertEquals(
    downscaledUrl('https://res.cloudinary.com/x/image/upload/v123/staging/abc.jpg', 512),
    'https://res.cloudinary.com/x/image/upload/w_512,c_limit,q_auto/v123/staging/abc.jpg',
  );
});

Deno.test('downscaledUrl — leaves an existing transformation alone', () => {
  // The caller asked for a specific rendition; stacking ours on top would
  // silently override a deliberate choice.
  const already = 'https://res.cloudinary.com/x/image/upload/w_200,c_fill/v1/a.jpg';
  assertEquals(downscaledUrl(already), already);
});

Deno.test('downscaledUrl — passes through a non-Cloudinary URL untouched', () => {
  // Guessing at an unknown URL shape would break the fetch outright.
  const other = 'https://example.com/photos/a.jpg';
  assertEquals(downscaledUrl(other), other);
  assertEquals(downscaledUrl(''), '');
});

// --- pairBatchResults -------------------------------------------------------

const entry = (index: number, caption: string) => ({ index, caption });

Deno.test('pairBatchResults — pairs each entry to the id at its index', () => {
  const { paired, missing } = pairBatchResults(
    ['a', 'b', 'c'],
    [entry(0, 'first'), entry(1, 'second'), entry(2, 'third')],
  );
  assertEquals(paired.map(p => p.id), ['a', 'b', 'c']);
  assertEquals(paired[0]?.parsed.caption, 'first');
  assertEquals(missing, []);
});

Deno.test('pairBatchResults — respects index, not arrival order', () => {
  // The whole reason the schema carries an index: a reordered array must not
  // attach one photo's grade to another.
  const { paired } = pairBatchResults(['a', 'b'], [entry(1, 'for-b'), entry(0, 'for-a')]);
  assertEquals(paired.find(p => p.id === 'a')?.parsed.caption, 'for-a');
  assertEquals(paired.find(p => p.id === 'b')?.parsed.caption, 'for-b');
});

Deno.test('pairBatchResults — reports a skipped photo as missing, never as a guess', () => {
  const { paired, missing } = pairBatchResults(['a', 'b', 'c'], [entry(0, 'x'), entry(2, 'z')]);
  assertEquals(paired.map(p => p.id), ['a', 'c']);
  assertEquals(missing, ['b']);
});

Deno.test('pairBatchResults — drops out-of-range and duplicate indices', () => {
  // A model that lost track of the ordering must not have its confusion
  // written into the cache as a real grade.
  const { paired, missing } = pairBatchResults(
    ['a', 'b'],
    [entry(0, 'first'), entry(0, 'duplicate'), entry(7, 'nowhere'), entry(-1, 'negative')],
  );
  assertEquals(paired.map(p => p.id), ['a']);
  assertEquals(paired[0]?.parsed.caption, 'first');
  assertEquals(missing, ['b']);
});

Deno.test('pairBatchResults — an empty answer leaves every photo ungraded', () => {
  const { paired, missing } = pairBatchResults(['a', 'b'], []);
  assertEquals(paired, []);
  assertEquals(missing, ['a', 'b']);
});

Deno.test('CLASSIFY_IMAGE_WIDTH — wide enough to still see blur', () => {
  // Category and scene survive far smaller, but `quality` grades sharpness and
  // a heavy downscale makes every photo look sharp. Guards against someone
  // shrinking this for payload reasons without weighing that.
  assert(CLASSIFY_IMAGE_WIDTH >= 768);
  // Twelve of these must stay well inside the inline-payload budget.
  assert(CLASSIFY_IMAGE_WIDTH <= 1024);
});

// The exact body staging returned while a scan sat on "Scanning your library".
const PER_DAY_429 = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota. Please retry in 53.996815314s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
          quotaValue: '20',
        }],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '53s' },
    ],
  },
});

const PER_MINUTE_429 = JSON.stringify({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '28s' },
    ],
  },
});

Deno.test('isDailyQuotaError — recognises the per-day cap behind a short retry delay', () => {
  // The delay says 53 seconds; the quota does not clear for hours. Honouring
  // the delay is what retried a spent budget until the scan gave up.
  assert(isDailyQuotaError(PER_DAY_429));
  // Structured RetryInfo wins over the prose, so 53 rather than ceil(53.99).
  assertEquals(parseRetryDelaySeconds(PER_DAY_429), 53);
});

Deno.test('isDailyQuotaError — leaves the per-minute cap alone', () => {
  // This one really does clear on its own, and must keep being waited out.
  assertEquals(isDailyQuotaError(PER_MINUTE_429), false);
});

Deno.test('isDailyQuotaError — anything unrecognised stays per-minute', () => {
  // Waiting a minute on a daily wall costs one retry; calling a recoverable
  // minute a dead day retires a scan that would have succeeded.
  assertEquals(isDailyQuotaError('{}'), false);
  assertEquals(isDailyQuotaError('not json'), false);
  assertEquals(isDailyQuotaError(JSON.stringify({ error: { details: [{ violations: [] }] } })), false);
});
