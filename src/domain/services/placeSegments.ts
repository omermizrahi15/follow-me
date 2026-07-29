import type { Coordinate } from '../interfaces';
import { distanceKm, representativeCoordinate, CLUSTER_RADIUS_KM } from './postingLocation';

/**
 * Splitting one posting window into the separate places it actually covered.
 *
 * A week that reads "three days in Madrid, three days in Lisbon" is two
 * stories, not one, and cramming both into a single post buries whichever came
 * first. This finds those stays so the publisher can be offered a split.
 *
 * Segments are built in TIME order rather than by clustering coordinates
 * alone: a trip is a sequence of stays, and the order matters to the story.
 * Returning to a city later is therefore its own segment — "Madrid, Lisbon,
 * Madrid again" is three legs of a journey, not two places visited.
 *
 * Pure: photos, their coordinates and their timestamps all come from the
 * caller, so it is exhaustively testable and knows nothing about the device.
 */

/** A photo the caller wants segmented, with whatever location it carries. */
export interface PlacedPhoto<T> {
  item: T;
  /** Absent when the photo has no GPS fix — common, and never a reason to split. */
  coordinate?: Coordinate;
  takenAt: Date;
}

export interface PlaceSegment<T> {
  items: T[];
  /** The stay's representative point, or null when nothing in it had GPS. */
  coordinate: Coordinate | null;
  start: Date;
  end: Date;
}

export interface SegmentOptions {
  /**
   * A stay needs at least this many located photos to count as its own
   * segment. Below it, the photos are folded into the neighbouring stay: one
   * shot from a layover airport or a day trip is not a second post, and
   * splitting on it would produce a post with a single photo in it.
   */
  minPhotos?: number;
  /** Distance at which a photo is considered somewhere else. */
  radiusKm?: number;
}

const DEFAULT_MIN_PHOTOS = 3;

/**
 * The stays a batch covers, in the order they happened. Always returns at
 * least one segment for a non-empty input — callers treat a length of 1 as
 * "nothing to split".
 */
export function splitByPlace<T>(
  photos: PlacedPhoto<T>[],
  options: SegmentOptions = {},
): PlaceSegment<T>[] {
  if (photos.length === 0) return [];

  const radiusKm = options.radiusKm ?? CLUSTER_RADIUS_KM;
  const minPhotos = options.minPhotos ?? DEFAULT_MIN_PHOTOS;

  const ordered = [...photos].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());

  // ── Pass 1: walk forward, starting a run whenever the location jumps ──────
  interface Run<U> { entries: PlacedPhoto<U>[]; located: Coordinate[] }
  const runs: Run<T>[] = [];

  for (const photo of ordered) {
    const current = runs[runs.length - 1];

    if (current == null) {
      runs.push({ entries: [photo], located: photo.coordinate != null ? [photo.coordinate] : [] });
      continue;
    }

    // A photo with no fix can't tell us the traveller moved, so it stays with
    // whatever stay it falls between in time.
    if (photo.coordinate == null) {
      current.entries.push(photo);
      continue;
    }

    const centre = representativeCoordinate(current.located);
    if (centre != null && distanceKm(centre, photo.coordinate) > radiusKm) {
      runs.push({ entries: [photo], located: [photo.coordinate] });
    } else {
      current.entries.push(photo);
      current.located.push(photo.coordinate);
    }
  }

  // ── Pass 2: absorb runs too small to be a post of their own ───────────────
  // Done repeatedly: folding one short run can leave its neighbour short too.
  let merged = true;
  while (merged && runs.length > 1) {
    merged = false;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (run == null || run.located.length >= minPhotos) continue;

      // Fold into whichever neighbour is nearer in place; ties and missing
      // coordinates fall back to the preceding stay, keeping the trip's order.
      const before = runs[i - 1];
      const after = runs[i + 1];
      const target = pickNeighbour(run, before, after);
      if (target == null) continue;

      target.entries.push(...run.entries);
      target.located.push(...run.located);
      target.entries.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
      runs.splice(i, 1);
      merged = true;
      break;
    }
  }

  // ── Pass 3: rejoin neighbours that turn out to be the same place ─────────
  // Absorbing a brief detour can leave the stays either side of it adjacent —
  // Madrid, one layover shot, Madrid again is ONE stay: the traveller never
  // really left. Without this the batch splits into two posts of the same city.
  for (let i = runs.length - 2; i >= 0; i--) {
    const left = runs[i];
    const right = runs[i + 1];
    if (left == null || right == null) continue;

    const leftCentre = representativeCoordinate(left.located);
    const rightCentre = representativeCoordinate(right.located);
    if (leftCentre == null || rightCentre == null) continue;
    if (distanceKm(leftCentre, rightCentre) > radiusKm) continue;

    left.entries.push(...right.entries);
    left.located.push(...right.located);
    left.entries.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    runs.splice(i + 1, 1);
  }

  return runs.map(run => {
    const times = run.entries.map(e => e.takenAt.getTime());
    return {
      items: run.entries.map(e => e.item),
      coordinate: representativeCoordinate(run.located),
      start: new Date(Math.min(...times)),
      end: new Date(Math.max(...times)),
    };
  });
}

interface RunLike<T> { entries: PlacedPhoto<T>[]; located: Coordinate[] }

/** The neighbouring stay a too-short run belongs to. */
function pickNeighbour<T>(
  run: RunLike<T>,
  before: RunLike<T> | undefined,
  after: RunLike<T> | undefined,
): RunLike<T> | undefined {
  if (before == null) return after;
  if (after == null) return before;

  const centre = representativeCoordinate(run.located);
  const beforeCentre = representativeCoordinate(before.located);
  const afterCentre = representativeCoordinate(after.located);
  if (centre == null || beforeCentre == null || afterCentre == null) return before;

  return distanceKm(afterCentre, centre) < distanceKm(beforeCentre, centre) ? after : before;
}
