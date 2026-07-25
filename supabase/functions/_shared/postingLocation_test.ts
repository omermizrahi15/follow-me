import { assertEquals } from '@std/assert';
import {
  type Coordinate,
  formatPlaceList,
  representativeCoordinate,
  representativeCoordinates,
} from './postingLocation.ts';
import { resolveBatchPlace } from './geocode.ts';

const lisbon: Coordinate = { latitude: 38.72, longitude: -9.14 };
const lisbonB: Coordinate = { latitude: 38.74, longitude: -9.15 };
const porto: Coordinate = { latitude: 41.15, longitude: -8.61 };
const london: Coordinate = { latitude: 51.51, longitude: -0.13 };

Deno.test('representativeCoordinate — per-axis median, ignores an outlier', () => {
  const result = representativeCoordinate([
    { latitude: 38.71, longitude: -9.13 },
    { latitude: 38.72, longitude: -9.14 },
    { latitude: 38.73, longitude: -9.15 },
    london, // stray photo
    { latitude: 38.72, longitude: -9.14 },
  ]);
  assertEquals(result?.latitude, 38.72);
});

Deno.test('representativeCoordinate — null for empty input', () => {
  assertEquals(representativeCoordinate([]), null);
});

Deno.test('representativeCoordinates — clusters nearby, splits far apart, largest first', () => {
  // 3 Lisbon-area + 1 Porto → two clusters, Lisbon (bigger) first.
  const reps = representativeCoordinates([lisbon, lisbonB, porto, lisbon]);
  assertEquals(reps.length, 2);
  assertEquals(Math.round(reps[0]!.latitude), 39); // Lisbon cluster
  assertEquals(Math.round(reps[1]!.latitude), 41); // Porto cluster
});

Deno.test('representativeCoordinates — same city collapses to one', () => {
  assertEquals(representativeCoordinates([lisbon, lisbonB, lisbon]).length, 1);
});

Deno.test('formatPlaceList — A / A & B / A, B & C / none', () => {
  assertEquals(formatPlaceList([]), null);
  assertEquals(formatPlaceList(['Tel Aviv']), 'Tel Aviv');
  assertEquals(formatPlaceList(['Tel Aviv', 'Paris']), 'Tel Aviv & Paris');
  assertEquals(formatPlaceList(['Tel Aviv', 'Paris', 'Rome']), 'Tel Aviv, Paris & Rome');
  // 4th is dropped (max 3).
  assertEquals(formatPlaceList(['Tel Aviv', 'Paris', 'Rome', 'Berlin']), 'Tel Aviv, Paris & Rome');
});

Deno.test('resolveBatchPlace — geocodes each cluster and joins, deduping names', () => {
  const name = (c: Coordinate): Promise<string | null> =>
    Promise.resolve(c.latitude > 45 ? 'London, UK' : 'Lisbon, Portugal');
  return resolveBatchPlace([lisbon, lisbonB, porto, london, lisbon], name).then(place => {
    // Lisbon cluster (largest) first, then Porto (also "Lisbon, Portugal" via the
    // fake — deduped), then London. Two distinct names survive.
    assertEquals(place, 'Lisbon, Portugal & London, UK');
  });
});

Deno.test('resolveBatchPlace — null when no coordinates', () =>
  resolveBatchPlace([], () => Promise.resolve('X')).then(p => assertEquals(p, null)));

Deno.test('resolveBatchPlace — null when nothing resolves', () =>
  resolveBatchPlace([lisbon], () => Promise.resolve(null)).then(p => assertEquals(p, null)));
