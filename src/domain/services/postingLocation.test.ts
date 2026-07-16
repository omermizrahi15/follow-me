import { representativeCoordinate, representativeCoordinates, suggestPlaceFromGuesses } from './postingLocation';

describe('representativeCoordinate', () => {
  it('returns null for an empty batch', () => {
    expect(representativeCoordinate([])).toBeNull();
  });

  it('returns the single coordinate for a batch of one', () => {
    const coord = { latitude: 38.72, longitude: -9.14 };
    expect(representativeCoordinate([coord])).toEqual(coord);
  });

  it('returns the per-axis median for an odd-sized batch', () => {
    const result = representativeCoordinate([
      { latitude: 38.70, longitude: -9.10 },
      { latitude: 38.72, longitude: -9.14 },
      { latitude: 38.74, longitude: -9.16 },
    ]);
    expect(result).toEqual({ latitude: 38.72, longitude: -9.14 });
  });

  it('averages the two middle values for an even-sized batch', () => {
    const result = representativeCoordinate([
      { latitude: 38.70, longitude: -9.10 },
      { latitude: 38.74, longitude: -9.14 },
    ]);
    expect(result?.latitude).toBeCloseTo(38.72);
    expect(result?.longitude).toBeCloseTo(-9.12);
  });

  it('is not dragged away by a single far-off outlier', () => {
    const result = representativeCoordinate([
      { latitude: 38.71, longitude: -9.13 },
      { latitude: 38.72, longitude: -9.14 },
      { latitude: 38.73, longitude: -9.15 },
      { latitude: 51.51, longitude: -0.13 }, // stray London photo in a Lisbon batch
      { latitude: 38.72, longitude: -9.14 },
    ]);
    expect(result?.latitude).toBeCloseTo(38.72);
    expect(result?.longitude).toBeCloseTo(-9.14);
  });
});

describe('representativeCoordinates — multi-place clustering', () => {
  const lisbon = { latitude: 38.72, longitude: -9.14 };
  const lisbonB = { latitude: 38.74, longitude: -9.15 };
  const porto = { latitude: 41.15, longitude: -8.61 };
  const portoB = { latitude: 41.16, longitude: -8.63 };
  const madrid = { latitude: 40.42, longitude: -3.70 };
  const rome = { latitude: 41.90, longitude: 12.50 };

  it('returns empty for no coordinates', () => {
    expect(representativeCoordinates([])).toEqual([]);
  });

  it('collapses one city to a single representative', () => {
    const reps = representativeCoordinates([lisbon, lisbonB]);
    expect(reps).toHaveLength(1);
    expect(reps[0]!.latitude).toBeCloseTo(38.73, 1);
  });

  it('returns both places for a two-city batch, largest group first', () => {
    const reps = representativeCoordinates([porto, lisbon, lisbonB, portoB, lisbon]);
    expect(reps).toHaveLength(2);
    // Lisbon has 3 photos, Porto 2 — Lisbon first.
    expect(reps[0]!.latitude).toBeCloseTo(38.72, 0);
    expect(reps[1]!.latitude).toBeCloseTo(41.15, 0);
  });

  it('caps at three places even when the batch spans four cities', () => {
    const reps = representativeCoordinates([lisbon, lisbon, porto, porto, madrid, madrid, rome]);
    expect(reps).toHaveLength(3);
  });

  it('honours a smaller max', () => {
    const reps = representativeCoordinates([lisbon, porto, madrid], 2);
    expect(reps).toHaveLength(2);
  });
});

describe('suggestPlaceFromGuesses', () => {
  it('returns null when there are no guesses at all', () => {
    expect(suggestPlaceFromGuesses([])).toBeNull();
    expect(suggestPlaceFromGuesses(['', '  ', undefined])).toBeNull();
  });

  it('returns the single guess', () => {
    expect(suggestPlaceFromGuesses(['Lisbon, Portugal'])).toBe('Lisbon, Portugal');
  });

  it('ranks by agreement — the most common guess comes first', () => {
    const result = suggestPlaceFromGuesses([
      'Porto, Portugal',
      'Lisbon, Portugal',
      'Lisbon, Portugal',
    ]);
    expect(result).toBe('Lisbon, Portugal & Porto, Portugal');
  });

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(suggestPlaceFromGuesses(['Lisbon, Portugal', 'lisbon, portugal'])).toBe('Lisbon, Portugal');
  });

  it('trims guesses and skips empties without losing the rest', () => {
    expect(suggestPlaceFromGuesses(['', ' Rome, Italy ', undefined])).toBe('Rome, Italy');
  });

  it('caps the suggestion at three places', () => {
    const result = suggestPlaceFromGuesses(['A', 'A', 'B', 'B', 'C', 'D']);
    expect(result).toBe('A, B & C');
  });
});
