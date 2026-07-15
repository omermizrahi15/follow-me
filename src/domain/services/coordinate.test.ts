import { validCoordinate } from './coordinate';

describe('validCoordinate', () => {
  it('returns the coordinate for a valid pair', () => {
    expect(validCoordinate(32.08, 34.78)).toEqual({ latitude: 32.08, longitude: 34.78 });
  });

  it('rejects NaN (iOS MediaLibrary location with no real GPS fix)', () => {
    expect(validCoordinate(NaN, NaN)).toBeNull();
    expect(validCoordinate(32.08, NaN)).toBeNull();
    expect(validCoordinate(NaN, 34.78)).toBeNull();
  });

  it('rejects Infinity', () => {
    expect(validCoordinate(Infinity, 0)).toBeNull();
    expect(validCoordinate(0, -Infinity)).toBeNull();
  });

  it('rejects out-of-range values', () => {
    expect(validCoordinate(91, 0)).toBeNull();
    expect(validCoordinate(0, 181)).toBeNull();
    expect(validCoordinate(-90.1, 0)).toBeNull();
  });

  it('rejects exact (0, 0) as the "no fix" marker', () => {
    expect(validCoordinate(0, 0)).toBeNull();
  });

  it('accepts the range boundaries', () => {
    expect(validCoordinate(90, 180)).toEqual({ latitude: 90, longitude: 180 });
    expect(validCoordinate(-90, -180)).toEqual({ latitude: -90, longitude: -180 });
  });
});
