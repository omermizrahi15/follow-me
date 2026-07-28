import { buildTravelRoute, greatCirclePath, haversineKm, unwrapLongitudes } from './travelRoute';
import type { TravelRouteInput } from './travelRoute';

const LISBON = { latitude: 38.7223, longitude: -9.1393 };
const RIO = { latitude: -22.9068, longitude: -43.1729 };
const TOKYO = { latitude: 35.6762, longitude: 139.6503 };
const LOS_ANGELES = { latitude: 34.0522, longitude: -118.2437 };

function posting(id: string, iso: string, overrides: Partial<TravelRouteInput> = {}): TravelRouteInput {
  return {
    id,
    date: 'June 18, 2026',
    createdAt: iso,
    thumbUrl: `https://res.cloudinary.com/demo/image/upload/w_108/${id}.jpg`,
    ...overrides,
  };
}

describe('buildTravelRoute — which posts get plotted', () => {
  it('orders stops oldest first, so the route reads as the trip', () => {
    const route = buildTravelRoute([
      posting('newest', '2026-06-20T10:00:00Z', { coordinate: RIO }),
      posting('oldest', '2026-06-01T10:00:00Z', { coordinate: LISBON }),
    ]);

    expect(route.stops.map(s => s.id)).toEqual(['oldest', 'newest']);
  });

  it('leaves out postings with no coordinate rather than guessing', () => {
    const route = buildTravelRoute([
      posting('placed', '2026-06-01T10:00:00Z', { coordinate: LISBON }),
      posting('unplaced', '2026-06-02T10:00:00Z', { place: 'Somewhere, Nowhere' }),
    ]);

    expect(route.stops.map(s => s.id)).toEqual(['placed']);
    expect(route.legs).toHaveLength(0);
  });

  it('positions are [lon, lat] — GeoJSON order, not lat/lon', () => {
    const route = buildTravelRoute([posting('a', '2026-06-01T10:00:00Z', { coordinate: LISBON })]);

    expect(route.stops[0]?.position).toEqual([LISBON.longitude, LISBON.latitude]);
  });

  it('carries the marker thumbnail through', () => {
    const route = buildTravelRoute([posting('a', '2026-06-01T10:00:00Z', { coordinate: LISBON })]);

    expect(route.stops[0]?.thumbUrl).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_108/a.jpg',
    );
  });

  it('a posting with no usable media still plots, without a thumbnail', () => {
    const route = buildTravelRoute([
      posting('a', '2026-06-01T10:00:00Z', { coordinate: LISBON, thumbUrl: null }),
    ]);

    expect(route.stops[0]?.thumbUrl).toBeNull();
  });
});

describe('buildTravelRoute — legs between stops', () => {
  it('joins consecutive stops', () => {
    const route = buildTravelRoute([
      posting('a', '2026-06-01T10:00:00Z', { coordinate: LISBON }),
      posting('b', '2026-06-02T10:00:00Z', { coordinate: RIO }),
      posting('c', '2026-06-03T10:00:00Z', { coordinate: TOKYO }),
    ]);

    expect(route.legs).toHaveLength(2);
  });

  // Two posts from the same hotel would otherwise draw a zero-length line with
  // a plane icon stamped on top of it.
  it('skips a leg between two stops at the same coordinate', () => {
    const route = buildTravelRoute([
      posting('a', '2026-06-01T10:00:00Z', { coordinate: LISBON }),
      posting('b', '2026-06-02T10:00:00Z', { coordinate: LISBON }),
    ]);

    expect(route.stops).toHaveLength(2);
    expect(route.legs).toHaveLength(0);
  });

  it('a short hop is a straight two-point line', () => {
    const nearLisbon = { latitude: 38.75, longitude: -9.15 };
    const route = buildTravelRoute([
      posting('a', '2026-06-01T10:00:00Z', { coordinate: LISBON }),
      posting('b', '2026-06-02T10:00:00Z', { coordinate: nearLisbon }),
    ]);

    expect(route.legs[0]?.path).toHaveLength(2);
  });

  it('a long haul is interpolated into an arc', () => {
    const route = buildTravelRoute([
      posting('a', '2026-06-01T10:00:00Z', { coordinate: LISBON }),
      posting('b', '2026-06-02T10:00:00Z', { coordinate: RIO }),
    ]);

    const path = route.legs[0]?.path ?? [];
    expect(path.length).toBeGreaterThan(10);
    // The arc starts and ends on its stops (within the rounding of the
    // degrees → radians → degrees round-trip, ~1e-12°, well under a micron).
    expect(path[0]?.[0]).toBeCloseTo(LISBON.longitude, 6);
    expect(path[0]?.[1]).toBeCloseTo(LISBON.latitude, 6);
    expect(path[path.length - 1]?.[0]).toBeCloseTo(RIO.longitude, 6);
    expect(path[path.length - 1]?.[1]).toBeCloseTo(RIO.latitude, 6);
  });
});

describe('greatCirclePath', () => {
  it('bows away from the straight line between distant points', () => {
    const path = greatCirclePath([-9.1393, 38.7223], [-118.2437, 34.0522], 2);
    const midpoint = path[1] as [number, number];
    // Lisbon → Los Angeles: the real flight path arcs well north of the
    // latitude midpoint (36.4°), over Greenland-ish latitudes.
    expect(midpoint[1]).toBeGreaterThan(45);
  });

  it('returns the endpoints unchanged for coincident points', () => {
    const point: [number, number] = [10, 20];
    expect(greatCirclePath(point, point, 8)).toEqual([point, point]);
  });
});

describe('unwrapLongitudes', () => {
  // Tokyo (139°E) → Los Angeles (118°W) is a short hop east across the Pacific,
  // but naively it is a 257° line the long way round, straight over Europe.
  it('takes the short way across the antimeridian', () => {
    const unwrapped = unwrapLongitudes([
      [TOKYO.longitude, TOKYO.latitude],
      [LOS_ANGELES.longitude, LOS_ANGELES.latitude],
    ]);

    expect(unwrapped[1]?.[0]).toBeCloseTo(LOS_ANGELES.longitude + 360, 6);
    expect(Math.abs((unwrapped[1]?.[0] ?? 0) - (unwrapped[0]?.[0] ?? 0))).toBeLessThan(180);
  });

  it('leaves a path that never crosses the antimeridian alone', () => {
    const path: Array<[number, number]> = [[-9, 38], [-43, -22]];
    expect(unwrapLongitudes(path)).toEqual(path);
  });

  it('keeps latitudes untouched', () => {
    const unwrapped = unwrapLongitudes([[170, 10], [-170, 20]]);
    expect(unwrapped.map(p => p[1])).toEqual([10, 20]);
  });
});

describe('haversineKm', () => {
  it('matches the known Lisbon → Rio distance', () => {
    const km = haversineKm([LISBON.longitude, LISBON.latitude], [RIO.longitude, RIO.latitude]);
    expect(km).toBeGreaterThan(7500);
    expect(km).toBeLessThan(7800);
  });

  it('is zero for the same point', () => {
    expect(haversineKm([10, 20], [10, 20])).toBe(0);
  });
});
