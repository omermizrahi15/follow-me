import type { Coordinate } from '../interfaces';
import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoClassification } from '../entities/PhotoClassification';
import { PhotoSelectionService } from './PhotoSelectionService';
import { splitByPlace } from './placeSegments';
import type { SegmentOptions } from './placeSegments';

/**
 * Turning "this week covered two cities" into two ready-made posts.
 *
 * The split is offered, never applied: segmentation is a heuristic over GPS,
 * and a wrong guess should cost the publisher one dismissal rather than an
 * unwanted extra post. Callers show `segments` only when there is more than
 * one, and keep the original batch until the publisher accepts.
 *
 * Each place is selected FRESH from everything classified for the window —
 * batch and pool alike — rather than by partitioning the batch that was
 * already chosen. Partitioning would hand back two thin posts (a ten-photo
 * batch becoming six and four); re-selecting gives each place a proper post up
 * to the full photos-per-post. It costs nothing extra: every candidate has
 * already been classified, so this is pure re-ranking with no AI calls.
 */

export interface PlaceSplitSegment {
  /** The stay's representative point, null when none of its photos had GPS. */
  coordinate: Coordinate | null;
  start: Date;
  end: Date;
  /** A full post's worth of photos for this place, best first. */
  batch: PhotoClassification[];
  /** Everything classified for this place, for swaps after the split. */
  pool: PhotoClassification[];
}

/**
 * @param classified   Every photo classified for the window (batch + pool).
 * @param coordinateOf Where each photo was taken; undefined when it has no fix.
 * @param alreadySent  Candidate ids already published, excluded from selection.
 */
export function suggestPlaceSplit(
  classified: PhotoClassification[],
  coordinateOf: (candidateId: string) => Coordinate | undefined,
  config: PublisherConfig,
  alreadySent: Set<string> = new Set(),
  options: SegmentOptions = {},
  selection: PhotoSelectionService = new PhotoSelectionService(),
): PlaceSplitSegment[] {
  if (classified.length === 0) return [];

  const segments = splitByPlace(
    classified.map(c => {
      const coordinate = coordinateOf(c.candidate.id);
      return coordinate != null
        ? { item: c, takenAt: c.candidate.createdAt, coordinate }
        : { item: c, takenAt: c.candidate.createdAt };
    }),
    options,
  );

  // One stay means there is nothing to offer; say so with an empty result
  // rather than a single segment the caller would have to special-case.
  if (segments.length < 2) return [];

  return segments.map(segment => ({
    coordinate: segment.coordinate,
    start: segment.start,
    end: segment.end,
    batch: selection.selectBatch(segment.items, config, alreadySent),
    pool: segment.items,
  }));
}
