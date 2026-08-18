import { useCallback, useEffect, useState } from 'react';
import { loadConfig } from '../../composition/container';
import { suggestPlaceSplit } from '../../domain/services/splitSuggestion';
import type { PlaceSplitSegment } from '../../domain/services/splitSuggestion';
import type { Coordinate } from '../../domain/interfaces';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { SuggestPhase } from './useSuggestedPhotos';

/**
 * "You were in 2 places" — splitting one week's photos into a post per stay.
 *
 * `offered` is only a suggestion: segmentation is a heuristic over GPS, so a
 * wrong guess costs one dismissal rather than an unwanted post. `accepted` is
 * set once the publisher takes it, and walks the places one post at a time.
 */

export interface PlaceSplit {
  /** Segments worth offering, or null when there is nothing to offer. */
  offered: PlaceSplitSegment[] | null;
  /** The split in progress, once accepted. */
  accepted: { segments: PlaceSplitSegment[]; index: number } | null;
  /** Take the offer — returns the first leg to show. */
  accept: () => PlaceSplitSegment | null;
  /** Keep it as one post, and stop asking for this scan. */
  dismiss: () => void;
  /** After posting a leg: the next one, or null when that was the last. */
  advance: () => PlaceSplitSegment | null;
}

interface Args {
  phase: SuggestPhase;
  /** Photo GPS is still being probed — segmentation would see nothing yet. */
  placeLoading: boolean;
  batch: PhotoClassification[];
  pool: PhotoClassification[];
  publisherId: string;
  coordinateOf: (id: string) => Coordinate | undefined;
}

export function usePlaceSplit({
  phase, placeLoading, batch, pool, publisherId, coordinateOf,
}: Args): PlaceSplit {
  const [offered, setOffered] = useState<PlaceSplitSegment[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [accepted, setAccepted] = useState<{ segments: PlaceSplitSegment[]; index: number } | null>(null);

  // Look for separate stays only once the place probe has run — before that the
  // coordinate cache is empty and every photo looks un-located, so no split
  // could be found however far apart the photos actually were.
  useEffect(() => {
    if (phase !== 'done' || placeLoading || accepted != null || dismissed) return;
    // Object property, not a local: eslint flow-narrows a `let` here and the
    // cleanup closure flips it only after this body has been analysed (same
    // reason as the place-resolution effect).
    const run = { cancelled: false };
    const isStale = (): boolean => run.cancelled;
    void (async (): Promise<void> => {
      const config = await loadConfig.execute(publisherId).catch(() => null);
      if (config == null || isStale()) return;
      const segments = suggestPlaceSplit([...batch, ...pool], coordinateOf, config);
      if (!isStale()) setOffered(segments.length >= 2 ? segments : null);
    })();
    return () => { run.cancelled = true; };
  }, [phase, placeLoading, batch, pool, publisherId, accepted, dismissed, coordinateOf]);

  const accept = useCallback((): PlaceSplitSegment | null => {
    if (offered == null) return null;
    setAccepted({ segments: offered, index: 0 });
    setOffered(null);
    return offered[0] ?? null;
  }, [offered]);

  const dismiss = useCallback((): void => {
    setOffered(null);
    setDismissed(true);
  }, []);

  const advance = useCallback((): PlaceSplitSegment | null => {
    if (accepted == null || accepted.index + 1 >= accepted.segments.length) return null;
    const next = accepted.index + 1;
    setAccepted({ segments: accepted.segments, index: next });
    return accepted.segments[next] ?? null;
  }, [accepted]);

  return { offered, accepted, accept, dismiss, advance };
}
