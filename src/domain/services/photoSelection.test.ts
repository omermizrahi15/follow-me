import { spreadQuality } from './photoSelection';


describe('spreadQuality — making a clustered scale usable', () => {
  // Measured on staging: 132 graded photos, mean 0.696, SD 0.042, everything
  // between 0.60 and 0.76 with 37 of them on exactly 0.70. The model uses about
  // a sixth of the scale, which is normal for an unanchored 0..1 holistic ask.
  //
  // That is fatal here rather than merely untidy. `scoreOf` multiplies quality
  // by the category weight, and the category weight spans 1.0 to 0.6 — five
  // times the spread quality has. So the ranking degenerated into "category
  // rank, then recency", and which photo was actually better stopped counting.
  it('stretches a clustered scan across a usable range', () => {
    // Staging's actual shape: everything in a 0.16-wide band, most of it on
    // three values. Raw, the whole scan differs by less than a third of what
    // one step of category ranking is worth.
    const cluster = Array.from({ length: 40 }, (_, i) => 0.65 + (i % 8) * 0.015);
    const spread = spreadQuality(cluster);

    const rawRange = Math.max(...cluster) - Math.min(...cluster);
    const spreadRange = Math.max(...spread.values()) - Math.min(...spread.values());

    expect(rawRange).toBeLessThan(0.15);
    expect(spreadRange).toBeGreaterThan(0.6);
  });

  // A distribution over two photos is not a distribution. Normalising against
  // it turns "0.85 and 0.80" into "the best and the worst photo there has ever
  // been", which is how a 0.05 gap came to overrule the publisher's own
  // "photos of me" preference — a weight tuned against the raw 0..1 scale.
  it('keeps a small gap small in a set too small to have a distribution', () => {
    const spread = spreadQuality([0.85, 0.8]);

    // A 0.05 gap must not come out the far side as the width of the scale, or
    // it overrules weights tuned against the raw one. Two photos rank each
    // other; they do not define a distribution.
    expect(spread.get(0.85)! - spread.get(0.8)!).toBeLessThan(0.2);
  });

  it('keeps the order the model gave — it spreads, it never reorders', () => {
    const spread = spreadQuality([0.65, 0.76, 0.7]);

    expect(spread.get(0.76)!).toBeGreaterThan(spread.get(0.7)!);
    expect(spread.get(0.7)!).toBeGreaterThan(spread.get(0.65)!);
  });

  it('gives photos the model could not separate the same spread value', () => {
    const spread = spreadQuality([0.7, 0.7, 0.9]);

    expect(spread.get(0.7)).toBeDefined();
    expect(spread.size).toBe(2);
  });

  // Zero would be filtered out by `score > 0` — the worst photo of a scan must
  // still be offerable, or a thin window loses its last candidate for being
  // last.
  it('never scores the worst photo out of existence', () => {
    const spread = spreadQuality([0.1, 0.2, 0.3]);

    expect(spread.get(0.1)!).toBeGreaterThan(0);
  });

  // Nothing to compare it to, so nothing is claimed: it keeps essentially the
  // grade the model gave it.
  it('leaves a lone photo where the model put it', () => {
    expect(spreadQuality([0.42]).get(0.42)).toBeCloseTo(0.42, 1);
  });

  it('has nothing to say about an empty scan', () => {
    expect(spreadQuality([]).size).toBe(0);
  });

  // The spread is about ORDERING. `minQuality` is an absolute standard —
  // "don't post anything below this" — and rewriting it in relative terms
  // would drop the bottom of every scan however good the photos were.
  it('is a separate number from the raw quality the floor is judged on', () => {
    const spread = spreadQuality([0.05, 0.9]);

    expect(spread.get(0.05)).not.toBe(0.05);
  });
});
