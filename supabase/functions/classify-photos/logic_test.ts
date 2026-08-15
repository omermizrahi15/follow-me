import { assert, assertEquals, assertThrows } from '@std/assert';
import {
  asCategory,
  bytesToBase64,
  clamp01,
  classifyCaller,
  parseClassification,
} from './logic.ts';

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
  });
});

Deno.test('parseClassification — defaults junk scores and text, keeping the stated category', () => {
  const c = parseClassification('id2', { category: 'other', confidence: 5, quality: 'x', caption: 123 });
  assertEquals(c, { id: 'id2', category: 'other', confidence: 1, quality: 0, caption: '', scene: '' });
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
