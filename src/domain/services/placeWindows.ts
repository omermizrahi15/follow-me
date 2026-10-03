import type { Coordinate } from '../interfaces';
import type { HistoryWindow } from './historyWindows';
import { splitByPlace } from './placeSegments';
import type { SegmentOptions } from './placeSegments';
import type { TimedItem } from './placeSampling';

/**
 * Cutting a history window where the traveller changed place.
 *
 * The backfill slices a trip into cadence-sized windows, which knows nothing
 * about where the publisher was: a week of Madrid then Lisbon became one post
 * that buried whichever came first. This takes a window and the photos in it
 * and returns sub-windows, one per stay, that together cover the original with
 * no gap and no overlap — so every photo still lands in exactly one of them.
 *
 * The cut falls midway between the last photo of one stay and the first of the
 * next. A window with one stay, no GPS at all, or no photos comes back
 * unchanged: place can only ever split a window, never drop or invent one.
 *
 * Pure. `coordinateOf` may know only a sample of the photos (reading GPS is a
 * lookup per photo); photos it cannot place follow the stay they fall in by
 * time, which is what `splitByPlace` does with a photo that has no fix.
 */
export function windowsByPlace(
  window: HistoryWindow,
  photos: TimedItem[],
  coordinateOf: (id: string) => Coordinate | undefined,
  options: SegmentOptions = {},
): HistoryWindow[] {
  const placed = photos.flatMap(p => {
    const coordinate = coordinateOf(p.id);
    return coordinate != null ? [{ item: p.id, takenAt: p.takenAt, coordinate }] : [];
  });
  if (placed.length === 0) return [window];

  const stays = splitByPlace(placed, options);
  if (stays.length < 2) return [window];

  const cuts: number[] = [];
  for (let i = 0; i < stays.length - 1; i++) {
    const end = stays[i]?.end.getTime();
    const next = stays[i + 1]?.start.getTime();
    if (end == null || next == null) return [window];
    cuts.push(Math.round((end + next) / 2));
  }

  const edges = [window.start.getTime(), ...cuts, window.end.getTime()];
  const out: HistoryWindow[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i];
    const end = edges[i + 1];
    if (start == null || end == null || end <= start) continue;
    out.push({ start: new Date(start), end: new Date(end) });
  }
  return out.length > 1 ? out : [window];
}
