// Server-side reverse geocoding for the autonomous auto-post job (issue #23):
// names a photo batch's place(s) from stored GPS so the push + WhatsApp message
// can say "from Tel Aviv". Mirrors src/infrastructure/geocoding/BigDataCloudGeocoder.ts
// (same free, keyless endpoint) plus the resolvePostingPlace clustering flow.

import { type Coordinate, formatPlaceList, representativeCoordinates } from './postingLocation.ts';

interface BigDataCloudResponse {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
}

/** Naming a place is a nice-to-have on the post path — give up quickly. */
const TIMEOUT_MS = 5000;

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value != null && value.trim() !== '') return value;
  }
  return null;
}

/**
 * "City, Country" for a coordinate (falling back through locality and region),
 * or null when it can't be resolved or the lookup times out. Never throws — a
 * failed lookup must not block a post.
 */
export async function reverseGeocode(coordinate: Coordinate): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const params = `latitude=${coordinate.latitude}&longitude=${coordinate.longitude}&localityLanguage=en`;
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`,
      { signal: controller.signal },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as BigDataCloudResponse;
    const city = firstNonEmpty(data.city, data.locality, data.principalSubdivision);
    const country = firstNonEmpty(data.countryName);
    if (city == null && country == null) return null;
    if (city != null && country != null) return `${city}, ${country}`;
    return city ?? country;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Names a batch's place(s): clusters the coordinates into up to 3 major spots
 * (largest photo group first), reverse-geocodes each, dedupes identical names,
 * and joins them ("Lisbon, Portugal & Porto, Portugal"). Null when there are no
 * coordinates or none resolve — a post must never block on naming the place.
 * Deno mirror of src/application/services/resolvePostingPlace.ts.
 */
export async function resolveBatchPlace(
  coordinates: Coordinate[],
  geocode: (c: Coordinate) => Promise<string | null> = reverseGeocode,
): Promise<string | null> {
  const places: string[] = [];
  for (const coordinate of representativeCoordinates(coordinates, 3)) {
    const place = await geocode(coordinate);
    if (place != null && !places.includes(place)) places.push(place);
  }
  return formatPlaceList(places);
}
