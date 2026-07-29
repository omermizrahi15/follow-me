import type { Coordinate } from '../interfaces';
import type { PlaceSegment } from './placeSegments';

/**
 * Working out a trip's itinerary from a handful of photos instead of all of
 * them.
 *
 * Reading GPS costs one media-library lookup per photo, so probing a busy
 * week's whole library takes seconds before anything can start. It is also
 * unnecessary: someone is in one city on a given day, so a couple of photos
 * per day pin down where they were, and the rest can be placed by their
 * timestamp alone.
 *
 * Two samples per day rather than one, by default — the first and last photo —
 * because one sample cannot see a move that happens *within* a day, which is
 * exactly what a travel day is.
 *
 * Pure: sampling and assignment are separated from the probing itself, so the
 * caller does the I/O and this stays exhaustively testable.
 */

export interface TimedItem {
  id: string;
  takenAt: Date;
}

const DEFAULT_PER_DAY = 2;

/** Local calendar day, as a sortable key. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The photos worth reading GPS from: up to `perDay` spread across each local
 * day — first and last when two, so a day that begins in one city and ends in
 * another still shows both.
 */
export function sampleForPlaceProbe(items: TimedItem[], perDay = DEFAULT_PER_DAY): string[] {
  if (items.length === 0 || perDay < 1) return [];

  const byDay = new Map<string, TimedItem[]>();
  for (const item of items) {
    const key = dayKey(item.takenAt);
    const bucket = byDay.get(key);
    if (bucket != null) bucket.push(item);
    else byDay.set(key, [item]);
  }

  const picked: string[] = [];
  for (const bucket of byDay.values()) {
    const sorted = [...bucket].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    if (perDay === 1 || sorted.length === 1) {
      // A single sample is best taken mid-day: the first photo of a travel day
      // is often still at the previous night's location.
      const middle = sorted[Math.floor(sorted.length / 2)];
      if (middle != null) picked.push(middle.id);
      continue;
    }
    // Evenly spaced across the day, always including its first and last.
    const step = (sorted.length - 1) / (perDay - 1);
    const seen = new Set<number>();
    for (let i = 0; i < perDay; i++) {
      const index = Math.round(i * step);
      if (seen.has(index)) continue;
      seen.add(index);
      const item = sorted[index];
      if (item != null) picked.push(item.id);
    }
  }
  return picked;
}

/**
 * Places every photo into the stay its timestamp falls in, given segments
 * derived from the samples.
 *
 * Segment boundaries are widened to meet each other halfway, so the whole
 * window is covered and a photo taken between two sampled moments still lands
 * somewhere — without this, everything not sampled would fall through the gaps.
 */
export function assignToSegments<S, T extends TimedItem>(
  items: T[],
  segments: PlaceSegment<S>[],
): { segment: PlaceSegment<S>; items: T[] }[] {
  if (segments.length === 0) return [];
  if (segments.length === 1) {
    const only = segments[0];
    return only != null ? [{ segment: only, items: [...items] }] : [];
  }

  // Cut points midway between the end of one stay and the start of the next.
  const cuts: number[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const end = segments[i]?.end.getTime();
    const nextStart = segments[i + 1]?.start.getTime();
    if (end == null || nextStart == null) continue;
    cuts.push((end + nextStart) / 2);
  }

  const buckets: T[][] = segments.map(() => []);
  for (const item of items) {
    const t = item.takenAt.getTime();
    let index = cuts.findIndex(cut => t < cut);
    if (index === -1) index = segments.length - 1;
    buckets[index]?.push(item);
  }

  return segments.map((segment, i) => ({
    segment,
    items: (buckets[i] ?? []).sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime()),
  }));
}

/** Convenience: a lookup from the probed subset, for feeding splitByPlace. */
export function probedCoordinate(
  probed: Map<string, Coordinate | undefined>,
): (id: string) => Coordinate | undefined {
  return id => probed.get(id);
}
