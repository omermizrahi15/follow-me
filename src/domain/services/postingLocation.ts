import type { Coordinate } from '../interfaces';

// Callers guarantee a non-empty input.
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * The coordinate that stands for a batch of photos: the per-axis median, so a
 * single photo taken somewhere else (an outlier, a screenshot with stale GPS)
 * doesn't drag the posting's place away from where most of the batch was shot.
 */
export function representativeCoordinate(coordinates: Coordinate[]): Coordinate | null {
  if (coordinates.length === 0) return null;
  return {
    latitude: median(coordinates.map(c => c.latitude)),
    longitude: median(coordinates.map(c => c.longitude)),
  };
}

/** Two photo spots further apart than this are different "places" (different city). */
export const CLUSTER_RADIUS_KM = 50;
const EARTH_RADIUS_KM = 6371;

export function distanceKm(a: Coordinate, b: Coordinate): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Representative coordinates for the batch's major places, largest group
 * first, capped at `max`. Photos are greedily clustered — a photo joins the
 * first cluster whose representative is within CLUSTER_RADIUS_KM, else starts
 * a new one — so a trip covering Lisbon and Porto yields both, while all-in-
 * one-city batches still collapse to a single median coordinate.
 */
export function representativeCoordinates(coordinates: Coordinate[], max = 3): Coordinate[] {
  const clusters: Coordinate[][] = [];
  for (const c of coordinates) {
    const home = clusters.find(members => {
      const center = representativeCoordinate(members);
      return center != null && distanceKm(center, c) <= CLUSTER_RADIUS_KM;
    });
    if (home != null) home.push(c);
    else clusters.push([c]);
  }
  return clusters
    .sort((a, b) => b.length - a.length)
    .slice(0, max)
    .map(members => representativeCoordinate(members))
    .filter((c): c is Coordinate => c != null);
}

/** "A" / "A & B" / "A, B & C" — how a posting names its place(s). */
export function formatPlaceList(places: string[]): string | null {
  const [first, second, third] = places;
  if (first == null) return null;
  if (second == null) return first;
  if (third == null) return `${first} & ${second}`;
  return `${first}, ${second} & ${third}`;
}

