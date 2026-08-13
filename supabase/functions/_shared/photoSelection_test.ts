// Deno-runtime coverage for the selection rules the auto-post function runs on.
// The rules themselves are the app's — src/domain/services/photoSelection.ts —
// and the exhaustive behavioural suite lives beside them in Jest. What this
// file proves is that the same module, driven through the flat row shape the
// server actually holds, still compiles and selects under Deno.
import { assert, assertEquals } from '@std/assert';
import {
  selectBatch,
  type PhotoFacts,
} from '../../../src/domain/services/photoSelection.ts';

/** The shape auto-post builds from candidate_photos + classify-photos. */
interface Row {
  assetId: string;
  url: string;
  category: string;
  quality: number;
  createdAt: number;
  scene: string;
}

const facts = (r: Row): PhotoFacts => ({
  id: r.assetId,
  category: r.category,
  quality: r.quality,
  createdAt: r.createdAt,
  scene: r.scene,
});

const day = (n: number): number => Date.parse(`2026-06-${String(n).padStart(2, '0')}T00:00:00Z`);

function row(
  assetId: string,
  category: string,
  quality: number,
  d: number,
  scene = '',
): Row {
  return { assetId, url: `https://cdn.test/${assetId}.jpg`, category, quality, createdAt: day(d), scene };
}

const ALL = ['selfie_with_view', 'selfie_with_people', 'nature', 'food'];

Deno.test('selectBatch — returns the caller\'s own row objects, not copies', () => {
  const rows = [row('f1', 'food', 0.9, 1)];
  const [selected] = selectBatch(rows, facts, { enabledCategories: ALL, photosPerPost: 5 }, new Set());
  assert(selected === rows[0]);
});

Deno.test('selectBatch — round-robins categories, best quality first', () => {
  const rows = [
    row('f1', 'food', 0.99, 1),
    row('f2', 'food', 0.80, 2),
    row('n1', 'nature', 0.70, 3),
    row('n2', 'nature', 0.60, 4),
  ];
  const ids = selectBatch(rows, facts, { enabledCategories: ['food', 'nature'], photosPerPost: 4 }, new Set())
    .map(r => r.assetId);
  assertEquals(ids, ['f1', 'n1', 'f2', 'n2']);
});

Deno.test('selectBatch — skips disabled categories and already-sent photos', () => {
  const rows = [row('f1', 'food', 0.9, 1), row('n1', 'nature', 0.9, 2), row('n2', 'nature', 0.8, 3)];
  const ids = selectBatch(rows, facts, { enabledCategories: ['nature'], photosPerPost: 5 }, new Set(['n1']))
    .map(r => r.assetId);
  assertEquals(ids, ['n2']);
});

Deno.test('selectBatch — dedupes repeated scenes, then bypasses the check to fill the quota', () => {
  const rows = [
    row('a', 'food', 0.9, 1, 'ramen-bar'),
    row('b', 'food', 0.8, 2, 'ramen-bar'),
    row('c', 'food', 0.7, 3, 'ramen-bar'),
  ];
  const two = selectBatch(rows, facts, { enabledCategories: ['food'], photosPerPost: 2 }, new Set());
  // Pass 1 takes one shot of the scene; pass 2 fills the second slot anyway.
  assertEquals(two.map(r => r.assetId), ['a', 'b']);
});

Deno.test("selectBatch — falls back to 'other' rather than returning an empty batch", () => {
  const rows = [row('o1', 'other', 0.9, 1), row('o2', 'other', 0.5, 2)];
  const ids = selectBatch(rows, facts, { enabledCategories: ALL, photosPerPost: 5 }, new Set())
    .map(r => r.assetId);
  assertEquals(ids, ['o1', 'o2']);
});

Deno.test('selectBatch — empty input selects nothing', () => {
  assertEquals(selectBatch([], facts, { enabledCategories: ALL, photosPerPost: 5 }, new Set()), []);
});
