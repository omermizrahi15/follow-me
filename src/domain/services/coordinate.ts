import type { Coordinate } from '../interfaces';

/**
 * A Coordinate from a raw latitude/longitude pair, or null when the pair isn't
 * a usable location. Coerces first, then rejects:
 *  - non-numeric input — iOS `expo-media-library` returns `location` coordinates
 *    as *strings* (e.g. `"24.5797"`), not numbers; `Number.isFinite` is false for
 *    those, so without coercion every geotagged photo was silently discarded and
 *    the posting resolved no place. `Number(value)` handles both string and
 *    number input; a genuinely absent/garbage value becomes NaN and is rejected.
 *  - NaN / Infinity — iOS can also report a `location` whose lat/lon are NaN for
 *    photos without a real GPS fix, which would poison the batch median and
 *    reverse-geocode as `NaN,NaN`.
 *  - out-of-range values (|lat| > 90, |lon| > 180).
 *  - exact (0, 0) — the classic "no fix" marker, not a real photo spot.
 */
export function validCoordinate(
  latitude: number | string,
  longitude: number | string,
): Coordinate | null {
  // Empty/whitespace strings coerce to 0 via Number(), which would masquerade
  // as a real coordinate — treat them as absent instead.
  const toNumber = (value: number | string): number =>
    typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  const lat = toNumber(latitude);
  const lon = toNumber(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { latitude: lat, longitude: lon };
}
