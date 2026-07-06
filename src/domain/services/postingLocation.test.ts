import { representativeCoordinate } from './postingLocation';

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
