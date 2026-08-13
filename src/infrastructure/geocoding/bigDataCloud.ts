// Where reverse geocoding actually goes, and how its answer becomes a place
// name. BigDataCloud's client-side endpoint needs no API key and is built for
// exactly this kind of lookup, which is why both runtimes are on it.
//
// DUAL RUNTIME — the app's `BigDataCloudGeocoder` and the Deno `_shared/geocode`
// both call it, so the endpoint and the response shape live here and stay
// import-free. Each runtime keeps its own fetch: the app logs through `__DEV__`
// (a React Native global that does not exist in Deno) and the server does not.
// See CONTRIBUTING.md.

export interface BigDataCloudResponse {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
}

/** A place lookup is a nice-to-have on the post path — give up quickly. */
export const GEOCODE_TIMEOUT_MS = 5000;

export function reverseGeocodeUrl(coordinate: { latitude: number; longitude: number }): string {
  const params = `latitude=${coordinate.latitude}&longitude=${coordinate.longitude}&localityLanguage=en`;
  return `https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`;
}

/**
 * "City, Country" from a response body, falling back through locality and
 * region when the city is missing, and to whichever half is present when only
 * one is. Null when there is nothing usable.
 */
export function placeFromResponse(data: BigDataCloudResponse): string | null {
  const city = firstNonEmpty(data.city, data.locality, data.principalSubdivision);
  const country = firstNonEmpty(data.countryName);
  if (city == null && country == null) return null;
  if (city != null && country != null) return `${city}, ${country}`;
  return city ?? country;
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value != null && value.trim() !== '') return value;
  }
  return null;
}
