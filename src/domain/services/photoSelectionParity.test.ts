/**
 * Parity guard: the Deno `_shared/photoSelection.ts` used by the auto-post Edge
 * Function must select exactly what the domain `PhotoSelectionService` does. If
 * someone changes one and not the other, this fails.
 */
import { PhotoSelectionService } from './PhotoSelectionService';
import { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoCategory, PhotoClassification } from '../entities/PhotoClassification';
import {
  selectBatch as sharedSelectBatch,
  deduplicateCandidates as sharedDedup,
  type SharedClassification,
} from '../../../supabase/functions/_shared/photoSelection';
import type { PhotoCandidate } from '../entities/PhotoCandidate';

interface Row {
  id: string;
  category: PhotoCategory;
  confidence: number;
  quality: number;
  createdAtMs: number;
}

function toDomain(r: Row): PhotoClassification {
  return {
    candidate: { id: r.id, uri: `https://cdn.test/${r.id}.jpg`, createdAt: new Date(r.createdAtMs) },
    category: r.category,
    confidence: r.confidence,
    quality: r.quality,
    caption: '',
    scene: '',
  };
}

function toShared(r: Row): SharedClassification {
  return {
    assetId: r.id,
    url: `https://cdn.test/${r.id}.jpg`,
    category: r.category,
    confidence: r.confidence,
    quality: r.quality,
    createdAt: r.createdAtMs,
    scene: '',
  };
}

const service = new PhotoSelectionService();

function assertParity(
  rows: Row[],
  opts: { enabledCategories: PhotoCategory[]; minQuality: number; photosPerPost: 5 | 10 | 15 },
  alreadySent: string[] = [],
): void {
  const config = PublisherConfig.create({
    publisherId: 'pub-1',
    frequency: 'weekly',
    requireApproval: false,
    enabledCategories: opts.enabledCategories,
    minQuality: opts.minQuality,
    photosPerPost: opts.photosPerPost,
  });
  const sent = new Set(alreadySent);

  const domainIds = service.selectBatch(rows.map(toDomain), config, sent).map(c => c.candidate.id);
  const sharedIds = sharedSelectBatch(
    rows.map(toShared),
    {
      enabledCategories: opts.enabledCategories,
      minQuality: opts.minQuality,
      photosPerPost: opts.photosPerPost,
    },
    sent,
  ).map(c => c.assetId);

  expect(sharedIds).toEqual(domainIds);
}

const ALL: PhotoCategory[] = ['selfie_with_view', 'selfie_with_people', 'nature', 'food'];

describe('deduplicateCandidates parity (domain vs _shared)', () => {
  function makeCandidates(pairs: [string, number][]): PhotoCandidate[] {
    return pairs.map(([id, ms]) => ({ id, uri: `https://cdn.test/${id}.jpg`, createdAt: new Date(ms) }));
  }

  function assertDedup(pairs: [string, number][]): void {
    const candidates = makeCandidates(pairs);
    const domainIds = service.deduplicateCandidates(candidates).map(c => c.id);
    const sharedIds = sharedDedup(candidates.map(c => ({ id: c.id, createdAt: c.createdAt.getTime() }))).map(c => c.id);
    expect(sharedIds).toEqual(domainIds);
  }

  it('matches on a burst group', () => {
    assertDedup([['a', 0], ['b', 10_000], ['c', 25_000], ['d', 30_000], ['e', 60_000]]);
  });

  it('matches when all gaps exceed the window', () => {
    assertDedup([['a', 0], ['b', 30_000], ['c', 60_000]]);
  });

  it('matches on empty input', () => {
    assertDedup([]);
  });
});

describe('photoSelection parity (domain vs _shared)', () => {
  const day = (n: number): number => Date.parse(`2026-06-${String(n).padStart(2, '0')}T00:00:00Z`);

  const sample: Row[] = [
    { id: 'f1', category: 'food', confidence: 0.9, quality: 0.99, createdAtMs: day(1) },
    { id: 'f2', category: 'food', confidence: 0.9, quality: 0.8, createdAtMs: day(2) },
    { id: 'v1', category: 'nature', confidence: 0.9, quality: 0.7, createdAtMs: day(3) },
    { id: 'v2', category: 'nature', confidence: 0.9, quality: 0.7, createdAtMs: day(5) },
    { id: 's1', category: 'selfie_with_view', confidence: 0.6, quality: 0.9, createdAtMs: day(4) },
    { id: 'lowq', category: 'food', confidence: 0.9, quality: 0.2, createdAtMs: day(6) },
    { id: 'lowc', category: 'food', confidence: 0.3, quality: 0.9, createdAtMs: day(7) },
    { id: 'junk', category: 'other', confidence: 0.9, quality: 0.9, createdAtMs: day(8) },
  ];

  it('matches on a mixed batch (diversity + filtering)', () => {
    assertParity(sample, { enabledCategories: ALL, minQuality: 0.4, photosPerPost: 5 });
  });

  it('matches when categories are restricted', () => {
    assertParity(sample, { enabledCategories: ['food', 'nature'], minQuality: 0.4, photosPerPost: 5 });
  });

  it('matches with already-sent exclusions', () => {
    assertParity(sample, { enabledCategories: ALL, minQuality: 0.4, photosPerPost: 5 }, ['f1', 'v1']);
  });

  it('matches with a higher quality bar', () => {
    assertParity(sample, { enabledCategories: ALL, minQuality: 0.75, photosPerPost: 5 });
  });
});
