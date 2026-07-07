import { PhotoSelectionService } from './PhotoSelectionService';
import { PublisherConfig } from '../entities/PublisherConfig';
import type { PublisherConfigProps } from '../entities/PublisherConfig';
import type { PhotoCategory, PhotoClassification } from '../entities/PhotoClassification';
import type { PhotoCandidate } from '../entities/PhotoCandidate';

let seq = 0;
// Separate counter just for timestamps so each make() call gets a unique day,
// regardless of whether opts.id is provided (which skips the seq++ for the id).
let makeSeq = 0;

interface Opts {
  id?: string;
  category?: PhotoCategory;
  confidence?: number;
  quality?: number;
  createdAt?: Date;
}

function make(opts: Opts = {}): PhotoClassification {
  const id = opts.id ?? `p${seq++}`;
  const dayOffset = makeSeq++;
  return {
    candidate: {
      id,
      uri: `https://cdn.test/${id}.jpg`,
      // Each call uses a different day so temporal-dedup tests don't collide.
      createdAt: opts.createdAt ?? new Date(Date.UTC(2026, 5, 1 + dayOffset)),
    },
    category: opts.category ?? 'view_only',
    confidence: opts.confidence ?? 0.9,
    quality: opts.quality ?? 0.8,
    caption: 'a photo',
    scene: '',
  };
}

function config(overrides: Partial<PublisherConfigProps> = {}): PublisherConfig {
  return PublisherConfig.create({
    publisherId: 'pub-1',
    frequency: 'weekly',
    photosPerPost: 5,
    requireApproval: true,
    ...overrides,
  });
}

const service = new PhotoSelectionService();
const ids = (batch: PhotoClassification[]): string[] => batch.map(c => c.candidate.id);

beforeEach(() => {
  seq = 0;
  makeSeq = 0;
});

describe('PhotoSelectionService — burst dedup', () => {
  function candidate(id: string, ms: number): PhotoCandidate {
    return { id, uri: `https://cdn.test/${id}.jpg`, createdAt: new Date(ms) };
  }

  it('returns empty for empty input', () => {
    expect(service.deduplicateCandidates([])).toEqual([]);
  });

  it('keeps a single photo', () => {
    const c = candidate('a', 0);
    expect(service.deduplicateCandidates([c])).toEqual([c]);
  });

  it('keeps only the first photo of a burst group', () => {
    const result = service.deduplicateCandidates([
      candidate('a', 0),
      candidate('b', 10_000),  // 10s after a → same burst
      candidate('c', 25_000),  // 25s after a → same burst
      candidate('d', 30_000),  // exactly 30s after a → new group (>= threshold)
      candidate('e', 35_000),  // 5s after d → same burst as d
    ]);
    expect(result.map(c => c.id)).toEqual(['a', 'd']);
  });

  it('keeps all photos when every gap exceeds the window', () => {
    const result = service.deduplicateCandidates([
      candidate('a', 0),
      candidate('b', 30_000),
      candidate('c', 60_000),
    ]);
    expect(result.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by createdAt before deduplicating (input order independent)', () => {
    // b is listed first but is earlier than a — after sort, a is kept
    const result = service.deduplicateCandidates([
      candidate('b', 10_000),
      candidate('a', 0),
    ]);
    // both within 30s → only earliest (a) is kept
    expect(result.map(c => c.id)).toEqual(['a']);
  });
});

describe('PhotoSelectionService — filtering', () => {
  it('returns an empty batch for empty input', () => {
    expect(service.selectBatch([], config())).toEqual([]);
  });

  it('prefers enabled categories over `other`', () => {
    // 5 eligible photos fills the quota — `other` is never needed.
    const fiveEligible = Array.from({ length: 5 }, (_, i) => make({ id: `keep${i}` }));
    const batch = service.selectBatch([...fiveEligible, make({ id: 'junk', category: 'other' })], config());
    expect(ids(batch)).not.toContain('junk');
    expect(batch).toHaveLength(5);
  });

  it('uses `other` as a last resort to fill the quota when eligible photos are exhausted', () => {
    // Only 1 eligible + 1 other, quota=5 → `other` photo is included to partially fill.
    const batch = service.selectBatch([make({ id: 'keep' }), make({ id: 'junk', category: 'other' })], config());
    expect(ids(batch)).toContain('keep');
    expect(ids(batch)).toContain('junk');
  });

  it('excludes categories the publisher disabled', () => {
    const cfg = config({ enabledCategories: ['view_only'] });
    const batch = service.selectBatch(
      [make({ id: 'kept', category: 'view_only' }), make({ id: 'dropped', category: 'food' })],
      cfg,
    );
    expect(ids(batch)).toEqual(['kept']);
  });

  it('excludes already-sent photos', () => {
    const batch = service.selectBatch(
      [make({ id: 'fresh' }), make({ id: 'old' })],
      config(),
      new Set(['old']),
    );
    expect(ids(batch)).toEqual(['fresh']);
  });

  it('deduplicates photos with the same scene in pass 1, but uses them in pass 2 to fill quota', () => {
    const cfg = config({ enabledCategories: ['view_only'], photosPerPost: 5 });
    const batch = service.selectBatch(
      [
        { ...make({ id: 'a', category: 'view_only', quality: 0.9 }), scene: 'beach-sunset' },
        { ...make({ id: 'b', category: 'view_only', quality: 0.8 }), scene: 'beach-sunset' },
        { ...make({ id: 'c', category: 'view_only', quality: 0.7 }), scene: 'mountain-view' },
      ],
      cfg,
    );
    // Pass 1: a + c (scene-diverse). Pass 2: b fills the remaining slot (quota=5, only 3 photos total).
    expect(ids(batch)).toEqual(['a', 'c', 'b']);
  });

  it('deduplicates same-scene photos across different categories (global scene set)', () => {
    // 'a' (selfie_with_view) and 'b' (view_only) share scene "beach-sunset" — different categories.
    // Without global scene dedup they would both appear; with it, only 'a' (higher quality) does.
    const cfg = config({ enabledCategories: ['selfie_with_view', 'view_only'], photosPerPost: 5 });
    const batch = service.selectBatch(
      [
        { ...make({ id: 'a', category: 'selfie_with_view', quality: 0.9 }), scene: 'beach-sunset' },
        { ...make({ id: 'b', category: 'view_only', quality: 0.85 }), scene: 'beach-sunset' },
        { ...make({ id: 'c', category: 'view_only', quality: 0.7 }), scene: 'mountain-view' },
      ],
      cfg,
    );
    // Pass 1: a (beach-sunset taken → b skipped), c (mountain-view taken). Only 2 unique scenes.
    // Pass 2: b fills the remaining slot.
    expect(ids(batch)).toEqual(['a', 'c', 'b']);
    // The key assertion: 'a' and 'b' are NOT both in the first two slots.
    expect(ids(batch).slice(0, 2)).not.toContain('b');
  });

  it('never dedups photos with blank or whitespace-only scenes', () => {
    // Blank scenes carry no visual-similarity signal — three photos with
    // empty/whitespace scenes must all be selectable, not collapse into one.
    const cfg = config({ enabledCategories: ['view_only'], photosPerPost: 5 });
    const batch = service.selectBatch(
      [
        { ...make({ id: 'a', category: 'view_only', quality: 0.9 }), scene: '' },
        { ...make({ id: 'b', category: 'view_only', quality: 0.8 }), scene: '   ' },
        { ...make({ id: 'c', category: 'view_only', quality: 0.7 }), scene: '' },
      ],
      cfg,
      new Set(),
    );
    expect(ids(batch)).toEqual(['a', 'b', 'c']);
  });

  it('respects scene dedup when the quota is already met by diverse photos', () => {
    // 5 distinct-scene photos fill quota=5 in pass 1; the same-scene extra is never pulled in.
    const cfg = config({ enabledCategories: ['view_only'], photosPerPost: 5 });
    const diversePhotos = ['scene-a', 'scene-b', 'scene-c', 'scene-d', 'scene-e'].map((s, i) => ({
      ...make({ id: `d${i}`, category: 'view_only' as const }),
      scene: s,
    }));
    // Lower quality so it sorts after all the diverse photos — it should never be reached.
    const sameScene = { ...make({ id: 'extra', category: 'view_only' as const, quality: 0.1 }), scene: 'scene-a' };
    const batch = service.selectBatch([...diversePhotos, sameScene], cfg);
    // quota filled by the 5 diverse photos; 'extra' is never reached.
    expect(ids(batch)).not.toContain('extra');
    expect(batch).toHaveLength(5);
  });
});

describe('PhotoSelectionService — ranking within a category', () => {
  it('ranks by quality descending', () => {
    const batch = service.selectBatch(
      [
        make({ id: 'mid', quality: 0.6 }),
        make({ id: 'best', quality: 0.95 }),
        make({ id: 'low', quality: 0.45 }),
      ],
      config({ enabledCategories: ['view_only'] }),
    );
    expect(ids(batch)).toEqual(['best', 'mid', 'low']);
  });

  it('breaks quality ties by recency (newest first)', () => {
    const batch = service.selectBatch(
      [
        make({ id: 'older', quality: 0.8, createdAt: new Date('2026-06-01T00:00:00Z') }),
        make({ id: 'newer', quality: 0.8, createdAt: new Date('2026-06-10T00:00:00Z') }),
      ],
      config({ enabledCategories: ['view_only'] }),
    );
    expect(ids(batch)).toEqual(['newer', 'older']);
  });
});

describe('PhotoSelectionService — diversity', () => {
  it('round-robins across categories instead of filling with one', () => {
    // food has more, higher-quality photos, but view_only must still appear.
    const cfg = config({ enabledCategories: ['view_only', 'food'] });
    const batch = service.selectBatch(
      [
        make({ id: 'f1', category: 'food', quality: 0.99 }),
        make({ id: 'f2', category: 'food', quality: 0.98 }),
        make({ id: 'f3', category: 'food', quality: 0.97 }),
        make({ id: 'f4', category: 'food', quality: 0.96 }),
        make({ id: 'f5', category: 'food', quality: 0.95 }),
        make({ id: 'v1', category: 'view_only', quality: 0.7 }),
        make({ id: 'v2', category: 'view_only', quality: 0.6 }),
      ],
      cfg,
    );
    // interleave in enabledCategories order until view_only is exhausted, then food fills
    expect(ids(batch)).toEqual(['v1', 'f1', 'v2', 'f2', 'f3']);
  });

  it('falls back to a single category when only one is present', () => {
    const cfg = config({ enabledCategories: ['food', 'view_only'] });
    const batch = service.selectBatch(
      [
        make({ id: 'a', category: 'food', quality: 0.5 }),
        make({ id: 'b', category: 'food', quality: 0.9 }),
        make({ id: 'c', category: 'food', quality: 0.7 }),
      ],
      cfg,
    );
    expect(ids(batch)).toEqual(['b', 'c', 'a']);
  });
});

describe('PhotoSelectionService — capacity', () => {
  it('caps the batch at photosPerPost', () => {
    const classifications = Array.from({ length: 8 }, (_, i) =>
      make({ id: `p${i}`, category: 'view_only', quality: 1 - i * 0.05 }),
    );
    const batch = service.selectBatch(classifications, config({ photosPerPost: 5 }));
    expect(batch).toHaveLength(5);
  });

  it('returns everything eligible when fewer than photosPerPost', () => {
    const batch = service.selectBatch(
      [make({ id: 'a' }), make({ id: 'b' }), make({ id: 'c' })],
      config({ photosPerPost: 5 }),
    );
    expect(ids(batch).sort()).toEqual(['a', 'b', 'c']);
  });
});
