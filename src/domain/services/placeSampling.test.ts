import { sampleForPlaceProbe, assignToSegments } from './placeSampling';
import type { TimedItem } from './placeSampling';
import { splitByPlace } from './placeSegments';

const at = (day: number, hour: number): Date => new Date(2026, 0, day, hour);

function photo(id: string, day: number, hour: number): TimedItem {
  return { id, takenAt: at(day, hour) };
}

/** A busy day: `count` photos spread across it. */
function busyDay(prefix: string, day: number, count: number): TimedItem[] {
  return Array.from({ length: count }, (_, i) =>
    photo(`${prefix}-${i}`, day, 8 + Math.floor((i * 12) / count)),
  );
}

describe('sampleForPlaceProbe — how few photos we can get away with', () => {
  it('probes a couple per day instead of the whole library', () => {
    // Three days, 40 photos each: 120 lookups become 6.
    const items = [...busyDay('a', 1, 40), ...busyDay('b', 2, 40), ...busyDay('c', 3, 40)];
    expect(sampleForPlaceProbe(items)).toHaveLength(6);
  });

  it('takes the first and last of a day, so a move within it is visible', () => {
    const items = [
      photo('morning', 1, 8),
      photo('noon', 1, 12),
      photo('evening', 1, 20),
    ];
    const picked = sampleForPlaceProbe(items);
    expect(picked).toContain('morning');
    expect(picked).toContain('evening');
  });

  it('covers every day the batch spans', () => {
    const items = [...busyDay('a', 1, 5), ...busyDay('b', 2, 5), ...busyDay('c', 9, 5)];
    const picked = new Set(sampleForPlaceProbe(items));
    expect([...picked].some(id => id.startsWith('a'))).toBe(true);
    expect([...picked].some(id => id.startsWith('b'))).toBe(true);
    expect([...picked].some(id => id.startsWith('c'))).toBe(true);
  });

  it('never returns the same photo twice for a thin day', () => {
    const picked = sampleForPlaceProbe([photo('only', 1, 9)]);
    expect(picked).toEqual(['only']);
  });

  it('takes a mid-day photo when asked for one per day', () => {
    // The first photo of a travel day is often still at last night's hotel.
    const items = [photo('early', 1, 7), photo('mid', 1, 13), photo('late', 1, 21)];
    expect(sampleForPlaceProbe(items, 1)).toEqual(['mid']);
  });

  it('honours a larger sample for a suspicious day', () => {
    expect(sampleForPlaceProbe(busyDay('a', 1, 20), 4)).toHaveLength(4);
  });

  it('handles an empty batch', () => {
    expect(sampleForPlaceProbe([])).toEqual([]);
  });
});

describe('assignToSegments — placing the photos that were never probed', () => {
  const RIO = { latitude: -22.9068, longitude: -43.1729 };
  const MADRID = { latitude: 40.4168, longitude: -3.7038 };

  /** Segments as they come back from splitByPlace over the sampled photos. */
  function segmentsFromSamples(): ReturnType<typeof splitByPlace<string>> {
    return splitByPlace<string>([
      { item: 'r1', takenAt: at(1, 9), coordinate: RIO },
      { item: 'r2', takenAt: at(2, 9), coordinate: RIO },
      { item: 'r3', takenAt: at(3, 9), coordinate: RIO },
      { item: 'm1', takenAt: at(5, 9), coordinate: MADRID },
      { item: 'm2', takenAt: at(6, 9), coordinate: MADRID },
      { item: 'm3', takenAt: at(7, 9), coordinate: MADRID },
    ]);
  }

  it('splits the full library along the sampled itinerary', () => {
    const segments = segmentsFromSamples();
    // Every photo of the week, most of which were never probed.
    const all = [...busyDay('rio', 1, 30), ...busyDay('mad', 6, 30)];

    const assigned = assignToSegments(all, segments);

    expect(assigned).toHaveLength(2);
    expect(assigned[0]?.items.every(i => i.id.startsWith('rio'))).toBe(true);
    expect(assigned[1]?.items.every(i => i.id.startsWith('mad'))).toBe(true);
  });

  it('loses nothing — every photo lands in exactly one stay', () => {
    const segments = segmentsFromSamples();
    const all = [...busyDay('rio', 1, 30), ...busyDay('mad', 6, 30)];

    const assigned = assignToSegments(all, segments);
    const placed = assigned.flatMap(a => a.items.map(i => i.id));

    expect(placed).toHaveLength(all.length);
    expect(new Set(placed).size).toBe(all.length);
  });

  it('places a photo taken in the untravelled gap between two stays', () => {
    const segments = segmentsFromSamples();
    // Day 4: nothing was sampled, and it sits between the two cities.
    const assigned = assignToSegments([photo('travel-day', 4, 12)], segments);
    const placed = assigned.filter(a => a.items.length > 0);
    expect(placed).toHaveLength(1);
  });

  it('puts everything in the one stay when the trip never moved', () => {
    const single = splitByPlace<string>([
      { item: 's', takenAt: at(1, 9), coordinate: RIO },
    ]);
    const all = busyDay('rio', 1, 12);
    expect(assignToSegments(all, single)[0]?.items).toHaveLength(12);
  });

  it('returns nothing when there are no segments', () => {
    expect(assignToSegments(busyDay('a', 1, 3), [])).toEqual([]);
  });

  it('keeps each stay in time order', () => {
    const segments = segmentsFromSamples();
    const shuffled = [...busyDay('rio', 1, 10)].reverse();
    const assigned = assignToSegments(shuffled, segments);
    const times = assigned[0]?.items.map(i => i.takenAt.getTime()) ?? [];
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
