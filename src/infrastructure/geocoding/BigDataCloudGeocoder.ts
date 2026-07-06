import type { Coordinate, IGeocoder } from '../../domain/interfaces';

interface BigDataCloudResponse {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
}

/** A place lookup is a nice-to-have on the share path — give up quickly. */
const TIMEOUT_MS = 5000;

/**
 * Reverse geocoding via BigDataCloud's free client-side endpoint — no API key,
 * built for exactly this kind of on-device lookup. Returns "City, Country"
 * (falling back through locality and region), or null when the coordinate
 * can't be resolved or the lookup exceeds the timeout. Never throws: a failed
 * lookup must not block a share.
 */
export class BigDataCloudGeocoder implements IGeocoder {
  async reverseGeocode(coordinate: Coordinate): Promise<string | null> {
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
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value != null && value.trim() !== '') return value;
  }
  return null;
}
