import { PhotoSelectionService, CONFIDENCE_THRESHOLD } from './PhotoSelectionService';
import { PublisherConfig } from '../entities/PublisherConfig';
import type { PublisherConfigProps } from '../entities/PublisherConfig';
import type { PhotoCategory, PhotoClassification } from '../entities/PhotoClassification';

let seq = 0;

interface Opts {
  id?: string;
  category?: PhotoCategory;
  confidence?: number;
  quality?: number;
  createdAt?: Date;
}

function make(opts: Opts = {}): PhotoClassification {
  const id = opts.id ?? `p${seq++}`;
  return {
    candidate: {
      id,
      uri: `https://cdn.test/${id}.jpg`,
      createdAt: opts.createdAt ?? new Date('2026-06-01T00:00:00Z'),
    },
    category: opts.category ?? 'view_only',
    confidence: opts.confidence ?? 0.9,
    quality: opts.quality ?? 0.8,
    caption: 'a photo',
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
});

describe('PhotoSelectionService — filtering', () => {
  it('returns an empty batch for empty input', () => {
    expect(service.selectBatch([], config())).toEqual([]);
  });

  it('excludes the `other` category', () => {
    const batch = service.selectBatch([make({ id: 'keep' }), make({ id: 'junk', category: 'other' })], config());
    expect(ids(batch)).toEqual(['keep']);
  });

  it('excludes categories the publisher disabled', () => {
    const cfg = config({ enabledCategories: ['view_only'] });
    const batch = service.selectBatch(
      [make({ id: 'kept', category: 'view_only' }), make({ id: 'dropped', category: 'food' })],
      cfg,
    );
    expect(ids(batch)).toEqual(['kept']);
  });

  it('excludes low-confidence classifications', () => {
    const batch = service.selectBatch(
      [make({ id: 'sure', confidence: CONFIDENCE_THRESHOLD }), make({ id: 'unsure', confidence: CONFIDENCE_THRESHOLD - 0.01 })],
      config(),
    );
    expect(ids(batch)).toEqual(['sure']);
  });

  it('excludes photos below the configured minimum quality', () => {
    const cfg = config({ minQuality: 0.5 });
    const batch = service.selectBatch(
      [make({ id: 'crisp', quality: 0.5 }), make({ id: 'blurry', quality: 0.49 })],
      cfg,
    );
    expect(ids(batch)).toEqual(['crisp']);
  });

  it('excludes already-sent photos', () => {
    const batch = service.selectBatch(
      [make({ id: 'fresh' }), make({ id: 'old' })],
      config(),
      new Set(['old']),
    );
    expect(ids(batch)).toEqual(['fresh']);
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
