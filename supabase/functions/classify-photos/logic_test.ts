import { assert, assertEquals } from '@std/assert';
import { bytesToBase64, clamp01, normalizeCategory, parseClassification } from './logic.ts';

Deno.test('clamp01 — clamps to [0,1] and defaults non-finite input to 0', () => {
  assertEquals(clamp01(0.5), 0.5);
  assertEquals(clamp01(-2), 0);
  assertEquals(clamp01(5), 1);
  assertEquals(clamp01('0.3'), 0.3); // string coercion
  assertEquals(clamp01('nope'), 0);
  assertEquals(clamp01(undefined), 0);
  assertEquals(clamp01(NaN), 0);
});

Deno.test('normalizeCategory — passes known categories through, maps unknowns to other', () => {
  assertEquals(normalizeCategory('food'), 'food');
  assertEquals(normalizeCategory('sunset_sunrise'), 'sunset_sunrise');
  assertEquals(normalizeCategory('banana'), 'other');
  assertEquals(normalizeCategory(42), 'other');
  assertEquals(normalizeCategory(null), 'other');
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

Deno.test('parseClassification — defends against junk/missing fields', () => {
  const c = parseClassification('id2', { category: 'weird', confidence: 5, quality: 'x', caption: 123 });
  assertEquals(c, { id: 'id2', category: 'other', confidence: 1, quality: 0, caption: '', scene: '' });
});
