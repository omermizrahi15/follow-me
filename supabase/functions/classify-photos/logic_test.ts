import { assert, assertEquals, assertThrows } from '@std/assert';
import {
  asCategory,
  CATEGORIES,
  qualityFrom,
  bytesToBase64,
  clamp01,
  classifyCaller,
  dailyQuotaFrom,
  parseClassification,
  CLASSIFY_IMAGE_WIDTH,
  downscaledUrl,
  isDailyQuotaError,
  isTransientUpstream,
  pacingWaitSeconds,
  TOKEN_WINDOW_SECONDS,
  MAX_REASON_LENGTH,
  pairBatchResults,
  parseRetryDelaySeconds,
  quotaSnapshot,
  requestedProviders,
} from './logic.ts';
import type { ProviderLimits } from './vision.ts';

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
    reason: '',
  });
});

Deno.test('parseClassification — defaults junk scores and text, keeping the stated category', () => {
  const c = parseClassification('id2', { category: 'other', confidence: 5, quality: 'x', caption: 123 });
  assertEquals(c, {
    id: 'id2', category: 'other', confidence: 1, quality: 0, caption: '', scene: '',
    contains_reference_person: false, reference_confidence: 0, reason: '',
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

Deno.test('quotaSnapshot reports the count and the ceiling as they are', () => {
  assertEquals(quotaSnapshot(137, 500, '2026-08-28'), { used: 137, limit: 500, day: '2026-08-28' });
});

Deno.test('quotaSnapshot keeps a count that overshot the ceiling', () => {
  // The counter is incremented before a request is judged, so the last request
  // of the day routinely lands above the limit. The app clamps it for display;
  // flattening it here would hide how far past the wall a run went.
  assertEquals(quotaSnapshot(507, 500, '2026-08-28').used, 507);
});

Deno.test('quotaSnapshot treats an unreadable count as nothing spent', () => {
  // The RPC fails open (a broken counter must not take classification down),
  // so `null` here means "we could not read it", and the request would be
  // allowed. Reporting it as a spent budget would contradict what happens.
  assertEquals(quotaSnapshot(null, 500, '2026-08-28').used, 0);
  assertEquals(quotaSnapshot(undefined, 500, '2026-08-28').used, 0);
  assertEquals(quotaSnapshot('137', 500, '2026-08-28').used, 0);
});

Deno.test('quotaSnapshot never reports a negative count', () => {
  assertEquals(quotaSnapshot(-3, 500, '2026-08-28').used, 0);
});

// ── Our own ceiling, now optional ───────────────────────────────────────────
//
// It used to default to 500 photos per user per day, which was a number nobody
// chose against anything real: it is not what any provider enforces, it is
// per-user where every provider limit is per-account, and it was the only
// figure the app could show a publisher. Unset now means we impose no ceiling
// of our own and the provider's real wall is the wall.

Deno.test('dailyQuotaFrom — unset means we add no ceiling of our own', () => {
  assertEquals(dailyQuotaFrom(undefined), null);
  assertEquals(dailyQuotaFrom(''), null);
});

Deno.test('dailyQuotaFrom — a number set deliberately is honoured', () => {
  // Still available as a cost brake, just no longer on by default.
  assertEquals(dailyQuotaFrom('750'), 750);
});

Deno.test('dailyQuotaFrom — zero switches classification off entirely', () => {
  // Distinct from unset: zero is a deliberate kill switch, and has to survive
  // as 0 rather than falling back to "no ceiling".
  assertEquals(dailyQuotaFrom('0'), 0);
});

Deno.test('dailyQuotaFrom — nonsense is no ceiling, never a silent 500', () => {
  // A typo'd secret must not quietly reinstate an invented limit.
  assertEquals(dailyQuotaFrom('lots'), null);
  assertEquals(dailyQuotaFrom('-5'), null);
});

Deno.test('quotaSnapshot — carries a null ceiling through untouched', () => {
  assertEquals(quotaSnapshot(42, null, '2026-08-29'), {
    used: 42,
    limit: null,
    day: '2026-08-29',
  });
});

// ── The model's own account of the grade ────────────────────────────────────

Deno.test('parseClassification — keeps the reason the model gave for its grade', () => {
  // The numbers alone never explained themselves: a 0.35 on a photo that looks
  // fine is unarguable-with until the model says "motion blur on the subject".
  const c = parseClassification('a', {
    category: 'food',
    confidence: 0.9,
    quality: 0.35,
    caption: 'Dinner',
    scene: 'restaurant-dinner',
    reason: 'Sharp plate but the subject is underexposed and the frame is cluttered.',
  });
  assertEquals(c.reason, 'Sharp plate but the subject is underexposed and the frame is cluttered.');
});

Deno.test('parseClassification — a missing reason is empty, never invented', () => {
  // Every grade bought before this field existed has none, and a made-up
  // rationale attached to a real grade is worse than an honest blank.
  const c = parseClassification('a', { category: 'nature', confidence: 1, quality: 1 });
  assertEquals(c.reason, '');
});

Deno.test('parseClassification — a rambling reason is trimmed to a readable length', () => {
  const c = parseClassification('a', {
    category: 'nature',
    confidence: 1,
    quality: 1,
    reason: 'x'.repeat(500),
  });
  assertEquals(c.reason.length, MAX_REASON_LENGTH);
});

// The provider chain. Groq leads by default: Gemini's free tier allows twenty
// requests a DAY on the only model whose free tier is not zeroed out, which is
// not enough to grade a single window — let alone a history backfill, which
// walks one window per posting interval and hit that wall on its first stretch.
Deno.test('requestedProviders defaults to groq with gemini behind it', () => {
  assertEquals(requestedProviders(undefined), ['groq', 'gemini']);
  assertEquals(requestedProviders(''), ['groq', 'gemini']);
  assertEquals(requestedProviders('   '), ['groq', 'gemini']);
});

Deno.test('requestedProviders reads an explicit chain in order', () => {
  assertEquals(requestedProviders('gemini'), ['gemini']);
  assertEquals(requestedProviders(' Gemini , GROQ '), ['gemini', 'groq']);
  assertEquals(requestedProviders('groq,,gemini,'), ['groq', 'gemini']);
});

// `cultural` was retired: museums, temples and historic sites are buildings,
// and a category that mostly duplicated `architecture` only gave the model
// another way to split photos that belong together.
//
// It cannot simply vanish from the list, though. `parseClassification` THROWS
// on an unrecognised category — deliberately, so a broken model contract can
// never reach the device disguised as a grade — so a model still answering
// "cultural" from a cached prompt would take the whole batch down with it.
Deno.test('asCategory folds the retired cultural category into architecture', () => {
  assertEquals(asCategory('cultural'), 'architecture');
});

Deno.test('asCategory still refuses a category that never existed', () => {
  assertEquals(asCategory('interpretive_dance'), null);
  assertEquals(asCategory(''), null);
  assertEquals(asCategory(undefined), null);
});

Deno.test('cultural is no longer a category the model may be told about', () => {
  assertEquals(CATEGORIES.includes('cultural' as never), false);
});

// Quality is now computed from four judgements the model makes separately,
// rather than asked for as one number.
//
// The single holistic ask produced almost no signal: 132 photos graded on
// staging came back with a mean of 0.696 and a standard deviation of 0.042,
// everything between 0.60 and 0.76, 37 of them on exactly 0.70. Photos fail in
// different ways — a blurred frame of a wonderful moment and a razor-sharp
// picture of a wall are both "about 0.7" holistically — and asking about the
// ways separately is what stops them collapsing onto the same number.
Deno.test('qualityFrom — weights the four judgements', () => {
  const perfect = qualityFrom({ sharpness: 1, exposure: 1, composition: 1, appeal: 1 });
  assertEquals(perfect, 1);
  assertEquals(qualityFrom({ sharpness: 0, exposure: 0, composition: 0, appeal: 0 }), 0);
});

// A photo nobody can look at is not saved by being interesting: focus and
// light are what make an image usable at all, and no amount of subject appeal
// recovers a smeared one.
Deno.test('qualityFrom — an unusable image cannot be rescued by its subject', () => {
  const smeared = qualityFrom({ sharpness: 0, exposure: 0.2, composition: 0.5, appeal: 1 });
  const plain = qualityFrom({ sharpness: 0.9, exposure: 0.9, composition: 0.6, appeal: 0.3 });
  assert(smeared < plain);
});

Deno.test('qualityFrom — a missing judgement counts as the middle, not as zero', () => {
  // Absent means the model did not answer, which is not the same as answering
  // badly. Scoring it zero would punish a photo for the model's omission.
  const partial = qualityFrom({ sharpness: 0.8 });
  assert(partial > 0.4 && partial < 0.8);
});

Deno.test('parseClassification — computes quality from the factors', () => {
  const c = parseClassification('p1', {
    category: 'nature',
    confidence: 0.9,
    sharpness: 0.9,
    exposure: 0.8,
    composition: 0.7,
    appeal: 0.9,
    caption: 'a photo',
    scene: 'beach',
    reason: 'crisp light',
  });
  assertEquals(c.quality > 0.8, true);
  assertEquals(c.factors?.sharpness, 0.9);
});

// A model answering the old shape must not be scored as though every factor
// were missing — that would drop every grade to the middle and wipe out the
// ranking entirely on the first request after a deploy.
Deno.test('parseClassification — falls back to a stated quality when no factors came', () => {
  const c = parseClassification('p1', {
    category: 'nature',
    confidence: 0.9,
    quality: 0.31,
    caption: 'a photo',
    scene: 'beach',
    reason: 'soft',
  });
  assertEquals(c.quality, 0.31);
  assertEquals(c.factors, undefined);
});

// The grade inspector shows `reason`. "0.31" explains nothing; the four numbers
// behind it explain everything — which is the whole point of asking for them
// separately. Appended server-side so the breakdown reaches the existing
// inspector without a schema change on the device.
Deno.test('parseClassification — appends the factor breakdown to the reason', () => {
  const c = parseClassification('p1', {
    category: 'nature',
    confidence: 0.9,
    sharpness: 0.2,
    exposure: 0.85,
    composition: 0.6,
    appeal: 0.95,
    caption: 'x',
    scene: 'beach',
    reason: 'motion blur on the subject',
  });

  assert(c.reason.startsWith('motion blur on the subject'));
  assert(c.reason.includes('sharp 0.2'));
  assert(c.reason.includes('appeal 0.95'));
});

Deno.test('parseClassification — appends nothing when the model stated no factors', () => {
  const c = parseClassification('p1', {
    category: 'nature', confidence: 0.9, quality: 0.5, caption: 'x', scene: 'b', reason: 'soft',
  });
  assertEquals(c.reason, 'soft');
});

// The breakdown must survive a model that used every word of its allowance —
// truncating the sentence first is what leaves room for it.
Deno.test('parseClassification — keeps the breakdown when the sentence is overlong', () => {
  const c = parseClassification('p1', {
    category: 'nature',
    confidence: 0.9,
    sharpness: 0.5, exposure: 0.5, composition: 0.5, appeal: 0.5,
    caption: 'x', scene: 'b',
    reason: 'y'.repeat(1000),
  });
  assert(c.reason.includes('sharp 0.5'));
});

Deno.test('isTransientUpstream — an overloaded or unreachable model is a pause, not a failure', () => {
  // Issue #189: Gemini answered 503 "the model is overloaded", which is a
  // property of that moment and clears by itself. It reached the app as a hard
  // ClassificationFailedError and ended the whole scan.
  assert(isTransientUpstream(503));
  assert(isTransientUpstream(500));
  assert(isTransientUpstream(502));
  assert(isTransientUpstream(504));
  assert(isTransientUpstream(0)); // request never completed
});

Deno.test('isTransientUpstream — a refused or malformed request is not worth retrying', () => {
  assert(!isTransientUpstream(400));
  assert(!isTransientUpstream(401));
  assert(!isTransientUpstream(403));
  assert(!isTransientUpstream(404));
  // 429 has its own reasons and its own wait; it must not be folded in here.
  assert(!isTransientUpstream(429));
});

// Pacing against the provider's own token budget.
//
// Groq's free tier allows 8,000 tokens a MINUTE and an image costs about a
// thousand, so the ceiling is roughly eight photos a minute. The app was
// sending twelve photos per request with four requests in flight — about
// 48,000 tokens against an 8,000 budget, six times over in the first second.
// Every scan 429'd immediately, fell through to Gemini's twenty-a-day, and
// died there. The headers that say so are on every response and nothing read
// them.
const tokenLimits = (remaining: number, resetSeconds: number | null): ProviderLimits => ({
  provider: 'groq',
  model: 'qwen/qwen3.6-27b',
  requests: { limit: 1000, remaining: 999, resetSeconds: 87 },
  tokens: { limit: 8000, remaining, resetSeconds },
  observedAt: 0,
});

Deno.test('pacingWaitSeconds — no wait when the budget covers the call', () => {
  assertEquals(pacingWaitSeconds(tokenLimits(8000, 21), 5), 0);
});

Deno.test('pacingWaitSeconds — waits out the window when it does not', () => {
  // Five images cost ~5000; only 1200 left.
  assertEquals(pacingWaitSeconds(tokenLimits(1200, 34), 5), 34);
});

// Firing anyway buys a 429, and a 429 is what sends the whole scan down the
// chain to a provider with twenty requests a day. Waiting is strictly cheaper.
Deno.test('pacingWaitSeconds — an exhausted window waits even for one image', () => {
  assertEquals(pacingWaitSeconds(tokenLimits(0, 12), 1), 12);
});

Deno.test('pacingWaitSeconds — nothing known means no wait', () => {
  // The first call of a request has heard nothing yet: it goes, and what comes
  // back paces everything after it.
  assertEquals(pacingWaitSeconds(null, 5), 0);
  assertEquals(pacingWaitSeconds({ ...tokenLimits(0, 10), tokens: null }, 5), 0);
});

Deno.test('pacingWaitSeconds — a provider that named no reset gets a whole window', () => {
  assertEquals(pacingWaitSeconds(tokenLimits(0, null), 5), TOKEN_WINDOW_SECONDS);
});

// The reference portrait rides in every call and costs tokens like any other
// image, so it has to be counted or the estimate is short on exactly the
// requests that are tightest.
Deno.test('pacingWaitSeconds — counts every image in the call, reference included', () => {
  assertEquals(pacingWaitSeconds(tokenLimits(5500, 30), 5), 0);
  assertEquals(pacingWaitSeconds(tokenLimits(5500, 30), 6), 30);
});
