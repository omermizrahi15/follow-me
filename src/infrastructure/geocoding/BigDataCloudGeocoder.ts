import type { Coordinate, IGeocoder } from '../../domain/interfaces';
import {
  GEOCODE_TIMEOUT_MS,
  placeFromResponse,
  reverseGeocodeUrl,
  type BigDataCloudResponse,
} from './bigDataCloud';

/**
 * Reverse geocoding via BigDataCloud's free client-side endpoint — no API key,
 * built for exactly this kind of on-device lookup. Returns "City, Country"
 * (falling back through locality and region), or null when the coordinate
 * can't be resolved or the lookup exceeds the timeout. Never throws: a failed
 * lookup must not block a share.
 *
 * The endpoint and the response parsing are in ./bigDataCloud, which the
 * server's geocoder imports too; what stays here is the on-device fetch and the
 * `__DEV__` logging.
 */
export class BigDataCloudGeocoder implements IGeocoder {
  async reverseGeocode(coordinate: Coordinate): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
      const response = await fetch(reverseGeocodeUrl(coordinate), { signal: controller.signal });
      if (!response.ok) {
        if (__DEV__) console.warn(`[geocode] HTTP ${response.status} for ${coordinate.latitude},${coordinate.longitude}`);
        return null;
      }
      const place = placeFromResponse((await response.json()) as BigDataCloudResponse);
      if (__DEV__) console.log(`[geocode] ${coordinate.latitude},${coordinate.longitude} → ${place ?? '?'}`);
      return place;
    } catch (e) {
      if (__DEV__) console.warn('[geocode] failed:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
