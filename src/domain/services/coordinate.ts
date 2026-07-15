import type { Coordinate } from '../interfaces';

/**
 * A Coordinate from a raw latitude/longitude pair, or null when the pair isn't
 * a usable location. Rejects:
 *  - NaN / Infinity — iOS `MediaLibrary` can report a `location` object whose
 *    latitude/longitude are NaN for photos without a real GPS fix, which would
 *    otherwise poison the batch median and reverse-geocode as `NaN,NaN`.
 *  - out-of-range values (|lat| > 90, |lon| > 180).
 *  - exact (0, 0) — the classic "no fix" marker, not a real photo spot.
 */
export function validCoordinate(latitude: number, longitude: number): Coordinate | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}
