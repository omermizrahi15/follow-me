import { PhotoSelectionService, isSuggestablePhoto } from './PhotoSelectionService';
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
  scene?: string;
  containsPublisher?: boolean;
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
    category: opts.category ?? 'nature',
    confidence: opts.confidence ?? 0.9,
    quality: opts.quality ?? 0.8,
    caption: 'a photo',
    scene: opts.scene ?? '',
    containsPublisher: opts.containsPublisher ?? false,
    publisherConfidence: opts.containsPublisher === true ? 0.9 : 0,
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

describe('PhotoSelectionService — burst ordering', () => {
  function candidate(id: string, ms: number): PhotoCandidate {
    return { id, uri: `https://cdn.test/${id}.jpg`, createdAt: new Date(ms) };
  }

  it('returns empty for empty input', () => {
    expect(service.gradingOrder([])).toEqual([]);
  });

  it('keeps a single photo', () => {
    const c = candidate('a', 0);
    expect(service.gradingOrder([c])).toEqual([c]);
  });

  it('puts one photo per burst first, then the followers — losing none', () => {
    const result = service.gradingOrder([
      candidate('a', 0),
      candidate('b', 10_000),  // 10s after a → same burst
      candidate('c', 25_000),  // 25s after a → same burst
      candidate('d', 30_000),  // exactly 30s after a → new group (>= threshold)
      candidate('e', 35_000),  // 5s after d → same burst as d
    ]);
    // Leaders newest-first (d, a), then followers newest-first (e, c, b).
    // Every photo is still here: the old dedup returned just ['a', 'd'] and
    // the other three were unreachable by any route the publisher had.
    expect(result.map(c => c.id)).toEqual(['d', 'a', 'e', 'c', 'b']);
  });

  it('treats every photo as its own moment when the gaps are wide', () => {
    const result = service.gradingOrder([
      candidate('a', 0),
      candidate('b', 30_000),
      candidate('c', 60_000),
    ]);
    expect(result.map(c => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by createdAt first, so input order cannot change the grouping', () => {
    const result = service.gradingOrder([
      candidate('b', 10_000),
      candidate('a', 0),
    ]);
    // a leads its burst (it is earliest); b follows rather than vanishing.
    expect(result.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('counts distinct moments without discarding anything', () => {
    const shots = [
      candidate('a', 0),
      candidate('b', 10_000),
      candidate('c', 30_000),
      candidate('d', 35_000),
    ];
    expect(service.distinctMoments(shots)).toBe(2);
    expect(service.gradingOrder(shots)).toHaveLength(4);
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
    const cfg = config({ enabledCategories: ['nature'] });
    const batch = service.selectBatch(
      [make({ id: 'kept', category: 'nature' }), make({ id: 'dropped', category: 'food' })],
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

  it('caps how many photos may share one scene, then fills by score', () => {
    const cfg = config({ enabledCategories: ['nature'], photosPerPost: 5 });
    const batch = service.selectBatch(
      [
        { ...make({ id: 'a', category: 'nature', quality: 0.9 }), scene: 'beach-sunset' },
        { ...make({ id: 'b', category: 'nature', quality: 0.8 }), scene: 'beach-sunset' },
        { ...make({ id: 'x', category: 'nature', quality: 0.75 }), scene: 'beach-sunset' },
        { ...make({ id: 'c', category: 'nature', quality: 0.7 }), scene: 'mountain-view' },
      ],
      cfg,
    );
    // Two beach-sunsets are allowed, the third waits; mountain-view goes ahead
    // of it. With the quota unmet, 'x' then fills the remaining slot.
    expect(ids(batch)).toEqual(['a', 'b', 'c', 'x']);
  });

  it('caps a scene across categories, not per category', () => {
    // 'a' (selfie_with_view) and 'b' (nature) share scene "beach-sunset". The
    // cap is global: two photos of one place is two photos of one place,
    // whatever the classifier called them.
    const cfg = config({ enabledCategories: ['selfie_with_view', 'nature'], photosPerPost: 5 });
    const batch = service.selectBatch(
      [
        { ...make({ id: 'a', category: 'selfie_with_view', quality: 0.9 }), scene: 'beach-sunset' },
        { ...make({ id: 'b', category: 'nature', quality: 0.85 }), scene: 'beach-sunset' },
        { ...make({ id: 'x', category: 'nature', quality: 0.8 }), scene: 'beach-sunset' },
        { ...make({ id: 'c', category: 'nature', quality: 0.7 }), scene: 'mountain-view' },
      ],
      cfg,
    );
    expect(ids(batch).slice(0, 3)).toEqual(['a', 'b', 'c']);
    // The third beach-sunset is deferred past the differently-scened photo.
    expect(ids(batch).indexOf('x')).toBeGreaterThan(ids(batch).indexOf('c'));
  });

  it('prefers the better photo over the higher-priority category', () => {
    // The old round-robin dealt one photo per category in turn, so a mediocre
    // photo in the first category outranked an excellent one in the second no
    // matter the grades. Quality leads now; priority only tilts.
    const cfg = config({ enabledCategories: ['nature', 'food'], photosPerPost: 5 });
    const batch = service.selectBatch(
      [
        make({ id: 'great-food', category: 'food', quality: 0.95 }),
        make({ id: 'poor-nature', category: 'nature', quality: 0.2 }),
        make({ id: 'good-food', category: 'food', quality: 0.9 }),
      ],
      cfg,
    );
    expect(ids(batch)).toEqual(['great-food', 'good-food', 'poor-nature']);
  });

  it('lets category priority break a tie between equally good photos', () => {
    const cfg = config({ enabledCategories: ['nature', 'food'], photosPerPost: 5 });
    const batch = service.selectBatch(
      [
        make({ id: 'f', category: 'food', quality: 0.8 }),
        make({ id: 'n', category: 'nature', quality: 0.8 }),
      ],
      cfg,
    );
    expect(ids(batch)).toEqual(['n', 'f']);
  });

  it('honours the publisher’s quality floor rather than padding the post', () => {
    // minQuality was stored on PublisherConfig and read by nothing at all.
    const cfg = config({ enabledCategories: ['nature'], photosPerPost: 5, minQuality: 0.5 });
    const batch = service.selectBatch(
      [
        make({ id: 'good', category: 'nature', quality: 0.9 }),
        make({ id: 'weak', category: 'nature', quality: 0.3 }),
      ],
      cfg,
    );
    expect(ids(batch)).toEqual(['good']);
  });

  it('never dedups photos with blank or whitespace-only scenes', () => {
    // Blank scenes carry no visual-similarity signal — three photos with
    // empty/whitespace scenes must all be selectable, not collapse into one.
    const cfg = config({ enabledCategories: ['nature'], photosPerPost: 5 });
    const batch = service.selectBatch(
      [
        { ...make({ id: 'a', category: 'nature', quality: 0.9 }), scene: '' },
        { ...make({ id: 'b', category: 'nature', quality: 0.8 }), scene: '   ' },
        { ...make({ id: 'c', category: 'nature', quality: 0.7 }), scene: '' },
      ],
      cfg,
      new Set(),
    );
    expect(ids(batch)).toEqual(['a', 'b', 'c']);
  });

  it('respects scene dedup when the quota is already met by diverse photos', () => {
    // 5 distinct-scene photos fill quota=5 in pass 1; the same-scene extra is never pulled in.
    const cfg = config({ enabledCategories: ['nature'], photosPerPost: 5 });
    const diversePhotos = ['scene-a', 'scene-b', 'scene-c', 'scene-d', 'scene-e'].map((s, i) => ({
      ...make({ id: `d${i}`, category: 'nature' as const }),
      scene: s,
    }));
    // Lower quality so it sorts after all the diverse photos — it should never be reached.
    const sameScene = { ...make({ id: 'extra', category: 'nature' as const, quality: 0.1 }), scene: 'scene-a' };
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
      config({ enabledCategories: ['nature'] }),
    );
    expect(ids(batch)).toEqual(['best', 'mid', 'low']);
  });

  it('breaks quality ties by recency (newest first)', () => {
    const batch = service.selectBatch(
      [
        make({ id: 'older', quality: 0.8, createdAt: new Date('2026-06-01T00:00:00Z') }),
        make({ id: 'newer', quality: 0.8, createdAt: new Date('2026-06-10T00:00:00Z') }),
      ],
      config({ enabledCategories: ['nature'] }),
    );
    expect(ids(batch)).toEqual(['newer', 'older']);
  });
});

describe('PhotoSelectionService — diversity', () => {
  it('lets a much better category win the post outright', () => {
    // The old round-robin guaranteed nature a slot per round regardless of how
    // much better the food photos were, which is precisely the behaviour the
    // grades were supposed to decide. Variety is now the scene cap's job, not
    // the category's — these all have distinct scenes, so nothing holds the
    // strong photos back.
    const cfg = config({ enabledCategories: ['nature', 'food'] });
    const batch = service.selectBatch(
      [
        { ...make({ id: 'f1', category: 'food', quality: 0.99 }), scene: 's1' },
        { ...make({ id: 'f2', category: 'food', quality: 0.98 }), scene: 's2' },
        { ...make({ id: 'f3', category: 'food', quality: 0.97 }), scene: 's3' },
        { ...make({ id: 'f4', category: 'food', quality: 0.96 }), scene: 's4' },
        { ...make({ id: 'f5', category: 'food', quality: 0.95 }), scene: 's5' },
        { ...make({ id: 'v1', category: 'nature', quality: 0.7 }), scene: 's6' },
        { ...make({ id: 'v2', category: 'nature', quality: 0.6 }), scene: 's7' },
      ],
      cfg,
    );
    expect(ids(batch)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });

  it('falls back to a single category when only one is present', () => {
    const cfg = config({ enabledCategories: ['food', 'nature'] });
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
      make({ id: `p${i}`, category: 'nature', quality: 1 - i * 0.05 }),
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

describe('isSuggestablePhoto', () => {
  it('accepts a photo in a category the publisher has enabled', () => {
    expect(isSuggestablePhoto(make({ category: 'food' }), config())).toBe(true);
  });

  it('accepts the `other` bucket, which ranking sinks to the bottom instead', () => {
    // Hiding `other` outright is what made "nothing else worth posting in those
    // days" a lie: far more photos land there than the name suggests, and they
    // were graded and held in the pool only to be filtered out of every offer.
    // They are offerable now and simply score last.
    expect(isSuggestablePhoto(make({ category: 'other' }), config())).toBe(true);
  });

  it('rejects categories the publisher switched off', () => {
    const onlyFood = config({ enabledCategories: ['food'] });
    expect(isSuggestablePhoto(make({ category: 'nature' }), onlyFood)).toBe(false);
    expect(isSuggestablePhoto(make({ category: 'food' }), onlyFood)).toBe(true);
  });

  it("under photosOfMe 'only', rejects photos the publisher isn't in", () => {
    // The "+" and the swap chip draw from this. Offering a photo the batch
    // rules would never accept hands back an empty-looking gesture — the same
    // reason the category gate is here.
    const onlyMe = config({ photosOfMe: 'only' });
    expect(isSuggestablePhoto(make({ containsPublisher: false }), onlyMe)).toBe(false);
    expect(isSuggestablePhoto(make({ containsPublisher: true }), onlyMe)).toBe(true);
  });

  it("under photosOfMe 'prefer', offers everything — it is a tilt, not a filter", () => {
    const preferMe = config({ photosOfMe: 'prefer' });
    expect(isSuggestablePhoto(make({ containsPublisher: false }), preferMe)).toBe(true);
  });
});

describe('PhotoSelectionService — photos of me (issue #137)', () => {
  /** The batch is returned best-first, so the head is what the preference moved. */
  const best = (batch: PhotoClassification[]): string | undefined => ids(batch)[0];

  it("'off' ignores the fact entirely: quality alone decides", () => {
    const batch = service.selectBatch(
      [
        make({ id: 'better-without-me', quality: 0.9, containsPublisher: false }),
        make({ id: 'worse-with-me', quality: 0.5, containsPublisher: true }),
      ],
      config(),
    );
    expect(best(batch)).toBe('better-without-me');
  });

  it("'prefer' settles a near-tie in favour of the photo the publisher is in", () => {
    const batch = service.selectBatch(
      [
        make({ id: 'slightly-better', quality: 0.85, containsPublisher: false }),
        make({ id: 'with-me', quality: 0.8, containsPublisher: true }),
      ],
      config({ photosOfMe: 'prefer' }),
    );
    expect(best(batch)).toBe('with-me');
  });

  it("'prefer' still loses to a clearly better photo — it must not become 'only'", () => {
    // 0.5 with the publisher scores 0.5; 0.95 without scores 0.95 × 0.7 = 0.665.
    // A wide enough gap has to survive the tilt, or `prefer` is just `only`.
    const batch = service.selectBatch(
      [
        make({ id: 'excellent-without-me', quality: 0.95, containsPublisher: false }),
        make({ id: 'mediocre-with-me', quality: 0.5, containsPublisher: true }),
      ],
      config({ photosOfMe: 'prefer' }),
    );
    expect(best(batch)).toBe('excellent-without-me');
  });

  it("'prefer' fills the rest of the post from photos without the publisher", () => {
    const batch = service.selectBatch(
      [
        make({ id: 'me', quality: 0.8, containsPublisher: true, scene: 'a' }),
        make({ id: 'other-1', quality: 0.7, containsPublisher: false, scene: 'b' }),
        make({ id: 'other-2', quality: 0.6, containsPublisher: false, scene: 'c' }),
      ],
      config({ photosOfMe: 'prefer' }),
    );
    expect(ids(batch)).toEqual(['me', 'other-1', 'other-2']);
  });

  it("'only' excludes photos without the publisher, however good they are", () => {
    const batch = service.selectBatch(
      [
        make({ id: 'excellent-without-me', quality: 1, containsPublisher: false }),
        make({ id: 'with-me', quality: 0.3, containsPublisher: true }),
      ],
      config({ photosOfMe: 'only' }),
    );
    expect(ids(batch)).toEqual(['with-me']);
  });

  it("'only' returns an empty batch rather than padding with strangers", () => {
    // Deliberately strict, like the category and quality filters beside it. The
    // alternative — quietly relaxing to fill the post — produces exactly the
    // batch of waiters and crowds that issue #137 was filed about, under a
    // setting that says the opposite.
    const batch = service.selectBatch(
      [make({ id: 'a', quality: 0.9 }), make({ id: 'b', quality: 0.8 })],
      config({ photosOfMe: 'only' }),
    );
    expect(batch).toEqual([]);
  });
});
