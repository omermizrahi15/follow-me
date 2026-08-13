// Server-side reverse geocoding for the autonomous post jobs (issue #23):
// names a photo batch's place(s) from stored GPS so the push + WhatsApp message
// can say "from Tel Aviv".
//
// The endpoint and response parsing come from the app's geocoding module, and
// the clustering/dedupe/join flow from the domain — all this file adds is the
// server's own fetch (no React Native `__DEV__` logging) and the default wiring
// of the two together.

import {
  resolveBatchPlace as resolveBatchPlaceWith,
  type Coordinate,
} from '../../../src/domain/services/postingLocation.ts';
import {
  GEOCODE_TIMEOUT_MS,
  placeFromResponse,
  reverseGeocodeUrl,
  type BigDataCloudResponse,
} from '../../../src/infrastructure/geocoding/bigDataCloud.ts';

export type { Coordinate };

/**
 * "City, Country" for a coordinate, or null when it can't be resolved or the
 * lookup times out. Never throws — a failed lookup must not block a post.
 */
export async function reverseGeocode(coordinate: Coordinate): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const response = await fetch(reverseGeocodeUrl(coordinate), { signal: controller.signal });
    if (!response.ok) return null;
    return placeFromResponse((await response.json()) as BigDataCloudResponse);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The batch's place name(s), looked up through the endpoint above by default. */
export function resolveBatchPlace(
  coordinates: Coordinate[],
  geocode: (c: Coordinate) => Promise<string | null> = reverseGeocode,
): Promise<string | null> {
  return resolveBatchPlaceWith(coordinates, geocode);
}
