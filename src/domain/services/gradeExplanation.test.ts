import { explainGrade, explainAll, type GradeExplanation } from './gradeExplanation';
import { selectBatch, type PhotoFacts, type SelectionRules } from './photoSelection';

const RULES: SelectionRules = {
  enabledCategories: ['sunset_sunrise', 'nature', 'food'],
  photosPerPost: 3,
};

function facts(over: Partial<PhotoFacts> = {}): PhotoFacts {
  return {
    id: 'a',
    category: 'nature',
    quality: 0.8,
    createdAt: 1_000,
    scene: 'mountain-trail',
    ...over,
  };
}

describe('explainGrade', () => {
  it('shows the score as the product of the factors that made it', () => {
    // The whole point: a publisher (or whoever is debugging) can multiply the
    // printed numbers themselves and land on the printed score. If they can't,
    // the explanation is decoration.
    const e = explainGrade(facts(), RULES, new Set());

    expect(e.factors.map(f => f.value).reduce((a, b) => a * b, 1)).toBeCloseTo(e.score, 10);
    expect(e.factors[0]).toEqual({
      key: 'quality',
      label: 'Quality',
      value: 0.8,
      detail: 'What the model scored the photo out of 1',
    });
  });

  it('names where a category sits in the publisher’s order', () => {
    const e = explainGrade(facts({ category: 'food' }), RULES, new Set());
    const category = e.factors.find(f => f.key === 'category');

    // Last of three enabled, so the narrow TOP..LAST spread bottoms out here.
    expect(category?.value).toBeCloseTo(0.85, 10);
    expect(category?.detail).toBe('food — priority 3 of 3');
  });

  it('says nothing about faces when the publisher never asked about them', () => {
    // `containsPublisher` is false both for "not in it" and "nobody asked", so
    // showing a face factor under `off` would state a fact nobody established.
    const e = explainGrade(facts(), RULES, new Set());
    expect(e.factors.some(f => f.key === 'publisher')).toBe(false);
  });

  it('weighs the publisher’s absence under prefer', () => {
    const rules = { ...RULES, photosOfMe: 'prefer' as const };
    const absent = explainGrade(facts({ containsPublisher: false }), rules, new Set());
    const present = explainGrade(facts({ containsPublisher: true }), rules, new Set());

    expect(absent.factors.find(f => f.key === 'publisher')?.value).toBeCloseTo(0.7, 10);
    expect(present.factors.find(f => f.key === 'publisher')?.value).toBe(1);
    expect(absent.score).toBeLessThan(present.score);
  });
});

describe('explainGrade — what kept a photo out of the post', () => {
  it('reports a switched-off category as the blocker it is', () => {
    const e = explainGrade(facts({ category: 'architecture' }), RULES, new Set());

    expect(e.score).toBe(0);
    expect(e.blockers).toEqual([
      { key: 'category-off', label: 'Category switched off', detail: 'architecture is not enabled' },
    ]);
  });

  it('reports the publisher’s own quality floor', () => {
    const e = explainGrade(facts({ quality: 0.3 }), { ...RULES, minQuality: 0.5 }, new Set());

    expect(e.blockers).toEqual([
      { key: 'below-min-quality', label: 'Below quality floor', detail: '0.30 is under your 0.50 floor' },
    ]);
  });

  it('reports a photo already sent, and does not pretend to score it', () => {
    // Already-sent photos are dropped before ranking, so a score for one would
    // be a number the app never actually computes.
    const e = explainGrade(facts(), RULES, new Set(['a']));

    expect(e.blockers.map(b => b.key)).toEqual(['already-sent']);
  });

  it('reports the photos-of-me filter only under only', () => {
    const only = { ...RULES, photosOfMe: 'only' as const };
    expect(explainGrade(facts({ containsPublisher: false }), only, new Set()).blockers)
      .toEqual([{
        key: 'not-publisher',
        label: 'You are not in it',
        detail: '“Only photos of me” is on',
      }]);
    expect(explainGrade(facts({ containsPublisher: false }), { ...RULES, photosOfMe: 'prefer' }, new Set()).blockers)
      .toEqual([]);
  });

  it('lists every blocker rather than only the first', () => {
    // A photo can be out for more than one reason, and fixing one setting to
    // find it still hidden is exactly the debugging dead end this replaces.
    const e = explainGrade(
      facts({ category: 'architecture', quality: 0.1 }),
      { ...RULES, minQuality: 0.5 },
      new Set(),
    );
    expect(e.blockers.map(b => b.key)).toEqual(['category-off', 'below-min-quality']);
  });

  it('has no blockers for a photo that would make the post', () => {
    expect(explainGrade(facts(), RULES, new Set()).blockers).toEqual([]);
  });
});

describe('explainAll', () => {
  const three: PhotoFacts[] = [
    { id: 'low', category: 'nature', quality: 0.2, createdAt: 3, scene: 'a' },
    { id: 'high', category: 'nature', quality: 0.9, createdAt: 2, scene: 'b' },
    { id: 'mid', category: 'nature', quality: 0.5, createdAt: 1, scene: 'c' },
  ];

  it('orders every photo by the same score the post is chosen with', () => {
    const explained = explainAll(three, f => f, RULES, new Set());
    expect(explained.map(e => e.facts.id)).toEqual(['high', 'mid', 'low']);
  });

  it('marks the ones the post would actually take, and their rank', () => {
    const explained = explainAll(three, f => f, { ...RULES, photosPerPost: 2 }, new Set());

    expect(explained.map(e => e.inBatch)).toEqual([true, true, false]);
    expect(explained.map(e => e.rank)).toEqual([1, 2, 3]);
  });

  it('explains a photo dropped by the scene cap, which no score reveals', () => {
    // Scene capping is the one selection rule that is not a property of the
    // photo — it depends on what outranked it — so it can only be worked out
    // over the whole set. A photo silently dropped here looks, from its own
    // numbers alone, like it should have made the post.
    const sameScene: PhotoFacts[] = [0.9, 0.8, 0.7].map((quality, i) => ({
      id: `p${i}`,
      category: 'nature',
      quality,
      createdAt: 10 - i,
      scene: 'old-city-market',
    }));

    // Room for three, but only two of one scene — so the third is passed over
    // by the cap rather than by the post simply being full.
    const explained = explainAll(sameScene, f => f, { ...RULES, photosPerPost: 3 }, new Set());

    expect(explained[2]?.blockers).toEqual([]);
    expect(explained[2]?.sceneCapped).toBe(true);
    // Still in the post: variety is a preference, and selectBatch backfills by
    // score when the cap leaves it short. The flag says why it was passed over
    // first, not that it was excluded.
    expect(explained.filter(e => e.inBatch).map(e => e.facts.id)).toEqual(['p0', 'p1', 'p2']);
  });

  it('agrees with selectBatch about which photos are in the post', () => {
    const many: PhotoFacts[] = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      category: i % 3 === 0 ? 'food' : 'nature',
      quality: (i * 7) % 10 / 10,
      createdAt: i,
      scene: `scene-${i % 4}`,
    }));
    const rules = { ...RULES, photosPerPost: 4, minQuality: 0.2 };

    const chosen = selectBatch(many, (f: PhotoFacts) => f, rules, new Set()).map(f => f.id);
    const explained: GradeExplanation<PhotoFacts>[] = explainAll(many, f => f, rules, new Set());
    const inBatch = explained.filter(e => e.inBatch).map(e => e.facts.id);

    // Two implementations of "what goes in the post" that disagree is the bug
    // this whole screen exists to catch, so it must not be the screen's own bug.
    expect(inBatch.sort()).toEqual(chosen.sort());
  });
});
