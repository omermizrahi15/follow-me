import { splitByPlace } from './placeSegments';
import type { PlacedPhoto } from './placeSegments';

const MADRID = { latitude: 40.4168, longitude: -3.7038 };
const LISBON = { latitude: 38.7223, longitude: -9.1393 };
const PORTO = { latitude: 41.1579, longitude: -8.6291 };
/** ~6km from Madrid centre — the same city, not a new place. */
const MADRID_SUBURB = { latitude: 40.47, longitude: -3.65 };

const day = (n: number, hour = 12): Date => new Date(Date.UTC(2026, 5, n, hour));

function photo(id: string, at: Date, coordinate?: { latitude: number; longitude: number }): PlacedPhoto<string> {
  return coordinate != null ? { item: id, takenAt: at, coordinate } : { item: id, takenAt: at };
}

/** Several photos in one place across consecutive days. */
function stay(prefix: string, coord: { latitude: number; longitude: number }, days: number[]): PlacedPhoto<string>[] {
  return days.map(d => photo(`${prefix}${d}`, day(d), coord));
}

const items = (segments: { items: string[] }[]): string[][] => segments.map(s => s.items);

describe('splitByPlace — a week in one place', () => {
  it('does not split a batch shot in a single city', () => {
    const segments = splitByPlace(stay('m', MADRID, [1, 2, 3, 4, 5]));
    expect(segments).toHaveLength(1);
    expect(segments[0]?.items).toHaveLength(5);
  });

  it('treats movement within a city as the same place', () => {
    const segments = splitByPlace([
      ...stay('m', MADRID, [1, 2]),
      ...stay('s', MADRID_SUBURB, [3, 4]),
    ]);
    expect(segments).toHaveLength(1);
  });

  it('returns nothing for an empty batch', () => {
    expect(splitByPlace([])).toEqual([]);
  });
});

describe('splitByPlace — two cities in one window', () => {
  // THE case: "three days in Madrid, three days in Lisbon" is two stories.
  const batch = [...stay('m', MADRID, [1, 2, 3]), ...stay('l', LISBON, [4, 5, 6])];

  it('splits into one segment per city', () => {
    expect(items(splitByPlace(batch))).toEqual([
      ['m1', 'm2', 'm3'],
      ['l4', 'l5', 'l6'],
    ]);
  });

  it('keeps them in the order they were travelled, not by size', () => {
    const lopsided = [...stay('m', MADRID, [1, 2, 3]), ...stay('l', LISBON, [4, 5, 6, 7, 8])];
    // Lisbon has more photos, but Madrid came first and the story runs forwards.
    expect(items(splitByPlace(lopsided))[0]?.[0]).toBe('m1');
  });

  it('gives each segment its own representative coordinate', () => {
    const [madrid, lisbon] = splitByPlace(batch);
    expect(madrid?.coordinate?.latitude).toBeCloseTo(MADRID.latitude, 2);
    expect(lisbon?.coordinate?.latitude).toBeCloseTo(LISBON.latitude, 2);
  });

  it('dates each segment from its own photos', () => {
    const [madrid, lisbon] = splitByPlace(batch);
    expect(madrid?.start).toEqual(day(1));
    expect(madrid?.end).toEqual(day(3));
    expect(lisbon?.start).toEqual(day(4));
    expect(lisbon?.end).toEqual(day(6));
  });

  it('splits three cities into three', () => {
    const segments = splitByPlace([
      ...stay('m', MADRID, [1, 2, 3]),
      ...stay('l', LISBON, [4, 5, 6]),
      ...stay('p', PORTO, [7, 8, 9]),
    ]);
    expect(segments).toHaveLength(3);
  });
});

describe('splitByPlace — returning to a place', () => {
  it('counts a return visit as its own leg of the journey', () => {
    // Madrid, Lisbon, Madrid again: three legs, because the order is the story.
    const segments = splitByPlace([
      ...stay('a', MADRID, [1, 2, 3]),
      ...stay('b', LISBON, [4, 5, 6]),
      ...stay('c', MADRID, [7, 8, 9]),
    ]);
    expect(items(segments)).toEqual([
      ['a1', 'a2', 'a3'],
      ['b4', 'b5', 'b6'],
      ['c7', 'c8', 'c9'],
    ]);
  });
});

describe('splitByPlace — noise that must not cause a split', () => {
  it('absorbs a single photo taken somewhere else', () => {
    // One shot from a layover; splitting on it would make a one-photo post.
    const segments = splitByPlace([
      ...stay('m', MADRID, [1, 2, 3]),
      photo('layover', day(4), LISBON),
      ...stay('m', MADRID, [5, 6, 7]),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.items).toContain('layover');
  });

  it('absorbs a short day trip below the photo threshold', () => {
    const segments = splitByPlace([
      ...stay('m', MADRID, [1, 2, 3, 4]),
      ...stay('trip', LISBON, [5, 6]),
    ]);
    expect(segments).toHaveLength(1);
  });

  it('splits once the second stay is substantial enough', () => {
    const segments = splitByPlace([
      ...stay('m', MADRID, [1, 2, 3, 4]),
      ...stay('l', LISBON, [5, 6, 7]),
    ]);
    expect(segments).toHaveLength(2);
  });

  it('honours a caller-supplied threshold', () => {
    const batch = [...stay('m', MADRID, [1, 2, 3, 4]), ...stay('l', LISBON, [5, 6])];
    expect(splitByPlace(batch, { minPhotos: 2 })).toHaveLength(2);
  });
});

describe('splitByPlace — photos without GPS', () => {
  it('never splits a batch that has no coordinates at all', () => {
    const segments = splitByPlace([
      photo('a', day(1)), photo('b', day(2)), photo('c', day(3)),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.coordinate).toBeNull();
  });

  it('carries un-located photos along with the stay they fall inside', () => {
    const segments = splitByPlace([
      ...stay('m', MADRID, [1, 2, 3]),
      photo('nogps', day(4)),
      ...stay('l', LISBON, [5, 6, 7]),
    ]);
    // The un-located photo sits between the two stays in time, so it belongs to
    // the one it interrupts — it cannot itself prove the traveller moved.
    expect(segments).toHaveLength(2);
    expect(segments[0]?.items).toContain('nogps');
  });
});

describe('splitByPlace — ordering', () => {
  it('sorts by time before segmenting, whatever order it is handed', () => {
    const shuffled = [
      photo('l5', day(5), LISBON),
      photo('m1', day(1), MADRID),
      photo('l6', day(6), LISBON),
      photo('m2', day(2), MADRID),
      photo('l4', day(4), LISBON),
      photo('m3', day(3), MADRID),
    ];
    expect(items(splitByPlace(shuffled))).toEqual([
      ['m1', 'm2', 'm3'],
      ['l4', 'l5', 'l6'],
    ]);
  });
});
