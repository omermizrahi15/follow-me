import type { Coordinate } from '../interfaces';

/**
 * A post as the route builder needs it: where, when, and what to show on the
 * marker. Deliberately not the UI's FeedPosting — the geometry has no business
 * knowing about feed types, and this way it is testable without React Native.
 */
export interface TravelRouteInput {
  id: string;
  /** Absent for posts whose photos carried no GPS; those are not plotted. */
  coordinate?: Coordinate | null;
  /** ISO timestamp — stops are ordered by it. */
  createdAt: string;
  /** Already-sized thumbnail URL for the marker, or null. */
  thumbUrl?: string | null;
  place?: string | null;
  date: string;
}

/** One plotted post on the globe. */
export interface RouteStop {
  id: string;
  /** [longitude, latitude] — GeoJSON order, which is what MapLibre consumes. */
  position: [number, number];
  /** Small square thumbnail for the circular marker. */
  thumbUrl: string | null;
  place: string | null;
  date: string;
}

/** A leg between two consecutive stops, already interpolated for drawing. */
export interface RouteLeg {
  /** Great-circle path from one stop to the next, as [lon, lat] pairs. */
  path: Array<[number, number]>;
}

export interface TravelRoute {
  stops: RouteStop[];
  legs: RouteLeg[];
}

/**
 * Legs shorter than this are drawn as a straight two-point line: below a few
 * hundred km a great circle and a straight line are visually identical, and
 * interpolating them just multiplies vertices.
 */
const ARC_MIN_KM = 300;
/** One interpolated point per this many km, so a long haul stays smooth. */
const KM_PER_ARC_POINT = 200;
const MAX_ARC_POINTS = 64;
const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance in km. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Points along the great circle from `a` to `b` — the path a plane actually
 * flies, and the arc the screenshots show. A straight line in the map's
 * Mercator space would cut visibly inside the real route on long hauls
 * (Lisbon → Rio bows several hundred km north of a straight line).
 *
 * Spherical linear interpolation on the unit vectors of the two points.
 */
export function greatCirclePath(
  a: [number, number],
  b: [number, number],
  steps: number,
): Array<[number, number]> {
  const [lon1, lat1] = a.map(toRad) as [number, number];
  const [lon2, lat2] = b.map(toRad) as [number, number];
  const d = 2 * Math.asin(
    Math.min(1, Math.sqrt(
      Math.sin((lat2 - lat1) / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
    )),
  );
  // Coincident (or antipodal, where the path is undefined) — nothing to arc.
  if (d === 0 || !Number.isFinite(d)) return [a, b];

  const path: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    path.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return path;
}

/**
 * Shifts each longitude by whole turns so consecutive points are never more
 * than half the world apart. Without this a Tokyo → Los Angeles leg (139 →
 * -118) is drawn as a 257° line the long way round the planet, straight across
 * Europe, instead of the short hop across the Pacific.
 */
export function unwrapLongitudes(path: Array<[number, number]>): Array<[number, number]> {
  const unwrapped: Array<[number, number]> = [];
  let offset = 0;
  path.forEach((point, index) => {
    const previous = path[index - 1];
    if (previous != null) {
      const delta = point[0] - previous[0];
      if (delta > 180) offset -= 360;
      else if (delta < -180) offset += 360;
    }
    unwrapped.push([point[0] + offset, point[1]]);
  });
  return unwrapped;
}

/**
 * The travel route for the Me-page globe: every posting that carries a
 * coordinate, oldest first, joined by the legs between consecutive stops.
 *
 * Postings without a coordinate are left out entirely rather than guessed at —
 * a marker in the wrong place is worse than no marker. Consecutive stops at the
 * same spot (two posts from one hotel) produce no leg: a zero-length line would
 * render as a stray dot with a plane icon stamped on it.
 */
export function buildTravelRoute(posts: TravelRouteInput[]): TravelRoute {
  const stops: RouteStop[] = posts
    .filter(p => p.coordinate != null)
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map(p => {
      const coordinate = p.coordinate as Coordinate;
      return {
        id: p.id,
        position: [coordinate.longitude, coordinate.latitude] as [number, number],
        thumbUrl: p.thumbUrl ?? null,
        place: p.place ?? null,
        date: p.date,
      };
    });

  const legs: RouteLeg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const from = (stops[i - 1] as RouteStop).position;
    const to = (stops[i] as RouteStop).position;
    const km = haversineKm(from, to);
    if (km === 0) continue;
    const steps = km < ARC_MIN_KM
      ? 1
      : Math.min(MAX_ARC_POINTS, Math.ceil(km / KM_PER_ARC_POINT));
    legs.push({ path: unwrapLongitudes(greatCirclePath(from, to, steps)) });
  }

  return { stops, legs };
}
