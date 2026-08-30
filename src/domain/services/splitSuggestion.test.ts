import { suggestPlaceSplit } from './splitSuggestion';
import { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoClassification } from '../entities/PhotoClassification';
import type { Coordinate } from '../interfaces';

const MADRID = { latitude: 40.4168, longitude: -3.7038 };
const LISBON = { latitude: 38.7223, longitude: -9.1393 };

const day = (n: number): Date => new Date(Date.UTC(2026, 5, n, 12));

function config(photosPerPost: 5 | 10 | 15 = 5): PublisherConfig {
  return PublisherConfig.create({
    publisherId: 'pub-1',
    frequency: 'weekly',
    photosPerPost,
    requireApproval: true,
  });
}

let seq = 0;
function shot(id: string, at: Date, quality = 0.8): PhotoClassification {
  return {
    candidate: { id, uri: `file:///${id}.jpg`, createdAt: at },
    category: 'nature',
    confidence: 0.9,
    quality,
    caption: '',
    // Distinct scenes, so the selector's scene-dedup doesn't thin the batches.
    scene: `scene-${seq++}`,
    containsPublisher: false,
    publisherConfidence: 0,
    reason: '',
  };
}
beforeEach(() => { seq = 0; });

/** `count` photos in one place, one per day from `fromDay`. */
function stay(prefix: string, from: number, count: number): PhotoClassification[] {
  return Array.from({ length: count }, (_, i) => shot(`${prefix}${i}`, day(from + i)));
}

function locator(map: Record<string, Coordinate>): (id: string) => Coordinate | undefined {
  return id => {
    const prefix = id.replace(/\d+$/, '');
    return map[prefix];
  };
}

describe('suggestPlaceSplit — when there is nothing to offer', () => {
  it('returns empty for a single-city week', () => {
    const photos = stay('m', 1, 6);
    expect(suggestPlaceSplit(photos, locator({ m: MADRID }), config())).toEqual([]);
  });

  it('returns empty when no photo has GPS', () => {
    const photos = stay('m', 1, 6);
    expect(suggestPlaceSplit(photos, () => undefined, config())).toEqual([]);
  });

  it('returns empty for an empty batch', () => {
    expect(suggestPlaceSplit([], () => MADRID, config())).toEqual([]);
  });

  it('returns empty when the second place is too brief to be a post', () => {
    const photos = [...stay('m', 1, 5), ...stay('l', 6, 2)];
    expect(suggestPlaceSplit(photos, locator({ m: MADRID, l: LISBON }), config())).toEqual([]);
  });
});

describe('suggestPlaceSplit — two cities', () => {
  const photos = [...stay('m', 1, 5), ...stay('l', 6, 5)];
  const where = locator({ m: MADRID, l: LISBON });

  it('offers one segment per place, in travel order', () => {
    const segments = suggestPlaceSplit(photos, where, config());

    expect(segments).toHaveLength(2);
    expect(segments[0]?.coordinate?.latitude).toBeCloseTo(MADRID.latitude, 2);
    expect(segments[1]?.coordinate?.latitude).toBeCloseTo(LISBON.latitude, 2);
  });

  it('gives each place its own dates', () => {
    const [madrid, lisbon] = suggestPlaceSplit(photos, where, config());
    expect(madrid?.start).toEqual(day(1));
    expect(lisbon?.end).toEqual(day(10));
  });

  it('keeps every photo in the place it was taken', () => {
    const [madrid, lisbon] = suggestPlaceSplit(photos, where, config());
    expect(madrid?.batch.every(c => c.candidate.id.startsWith('m'))).toBe(true);
    expect(lisbon?.batch.every(c => c.candidate.id.startsWith('l'))).toBe(true);
  });

  // The point of re-selecting rather than partitioning: ten photos split into
  // two posts should be two FULL posts, not a six and a four.
  it('gives each place a full post rather than a share of the original', () => {
    const big = [...stay('m', 1, 8), ...stay('l', 10, 8)];
    const segments = suggestPlaceSplit(big, where, config(5));

    expect(segments[0]?.batch).toHaveLength(5);
    expect(segments[1]?.batch).toHaveLength(5);
  });

  it('carries each place’s whole set as its pool, for swaps after the split', () => {
    const big = [...stay('m', 1, 8), ...stay('l', 10, 8)];
    const segments = suggestPlaceSplit(big, where, config(5));

    expect(segments[0]?.pool).toHaveLength(8);
    expect(segments[1]?.pool).toHaveLength(8);
  });

  it('respects photos-per-post', () => {
    const big = [...stay('m', 1, 20), ...stay('l', 22, 20)];
    const segments = suggestPlaceSplit(big, where, config(10));
    segments.forEach(s => expect(s.batch).toHaveLength(10));
  });

  it('excludes already-published photos from the new selection', () => {
    const big = [...stay('m', 1, 8), ...stay('l', 10, 8)];
    const sent = new Set(big.slice(0, 6).map(c => c.candidate.id)); // most of Madrid

    const segments = suggestPlaceSplit(big, where, config(5), sent);

    expect(segments[0]?.batch.every(c => !sent.has(c.candidate.id))).toBe(true);
    expect(segments[0]?.batch.length).toBeLessThan(5); // only what is left
  });
});

describe('suggestPlaceSplit — thresholds', () => {
  it('honours a caller-supplied minimum stay', () => {
    const photos = [...stay('m', 1, 5), ...stay('l', 6, 2)];
    const where = locator({ m: MADRID, l: LISBON });

    expect(suggestPlaceSplit(photos, where, config())).toEqual([]);
    expect(suggestPlaceSplit(photos, where, config(), new Set(), { minPhotos: 2 })).toHaveLength(2);
  });
});
