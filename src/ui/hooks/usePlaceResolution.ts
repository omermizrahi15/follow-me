import { useCallback, useEffect, useRef, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';
import { resolvePlaceForCoordinates } from '../../composition/container';
import type { Coordinate } from '../../domain/interfaces';
import { validCoordinate } from '../../domain/services/coordinate';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { SuggestPhase } from './useSuggestedPhotos';

/**
 * Where the post happened, and how sure we are of it.
 *
 * Resolution order, and the reason there is an order at all: a posting has to
 * land somewhere real on the map, and a typed label alone cannot be plotted
 * without guessing at a city centre. So the coordinate is kept, not just the
 * name it resolved to.
 *   1. GPS of the selected photos → reverse geocode.
 *   2. GPS of any other photo from the same scan (batch + pool) — same lookback
 *      window, almost always the same trip, minutes apart.
 *   3. Nothing, and it says so (issue #63): an empty place field used to be
 *      indistinguishable from one that had not finished loading.
 *
 * A manual edit always wins over re-resolution, including the edit that clears
 * the field.
 */

/** Which GPS source produced the place, for the note under the field. */
export type PlaceSource = 'photos' | 'scan' | 'none';

export interface PlaceResolution {
  place: string;
  loading: boolean;
  source: PlaceSource | null;
  /** GPS from the batch or the surrounding scan — decides whether a pick is required. */
  gpsCoordinate: Coordinate | undefined;
  /** The coordinate a picked suggestion carries, for batches with no photo GPS. */
  pickedCoordinate: Coordinate | undefined;
  /** Whether this post can be plotted at all. */
  canPost: boolean;
  /** The publisher typed or picked a place. Their edit sticks. */
  setPicked: (label: string, coordinate?: Coordinate) => void;
  /** Forget the resolved place — a rescan, or moving to the next split leg. */
  reset: () => void;
  /** Cached GPS for one asset. `undefined` also means "probed, none found". */
  coordinateOf: (id: string) => Coordinate | undefined;
  /** GPS for one asset, asking the library if it has not been looked at yet. */
  resolveCoordinate: (id: string) => Promise<Coordinate | undefined>;
  /** What to hand the share use case as the posting's place. */
  locationForPost: () => string | undefined;
}

interface Args {
  phase: SuggestPhase;
  /** The photo ids currently in the grid. */
  slots: string[];
  batch: PhotoClassification[];
  pool: PhotoClassification[];
}

export function usePlaceResolution({ phase, slots, batch, pool }: Args): PlaceResolution {
  const [place, setPlace] = useState('');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<PlaceSource | null>(null);
  const [gpsCoordinate, setGpsCoordinate] = useState<Coordinate | undefined>(undefined);
  const [pickedCoordinate, setPickedCoordinate] = useState<Coordinate | undefined>(undefined);
  const editedRef = useRef(false);
  // GPS per asset id (undefined = probed, no GPS), fetched once for the place
  // preview and reused on post.
  const coordsRef = useRef<Map<string, Coordinate | undefined>>(new Map());
  // Read through refs inside the resolution effect so a state change in the
  // middle of an await cannot make a stale answer look fresh.
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const placeRef = useRef(place);
  placeRef.current = place;

  const reset = useCallback((): void => {
    editedRef.current = false;
    setPlace('');
    setSource(null);
  }, []);

  const setPicked = useCallback((label: string, coordinate?: Coordinate): void => {
    editedRef.current = true;
    setSource(null);
    setPlace(label);
    setPickedCoordinate(coordinate);
  }, []);

  const coordinateOf = useCallback((id: string): Coordinate | undefined => coordsRef.current.get(id), []);

  const resolveCoordinate = useCallback(async (id: string): Promise<Coordinate | undefined> => {
    if (coordsRef.current.has(id)) return coordsRef.current.get(id);
    try {
      const info = await MediaLibrary.getAssetInfoAsync(id);
      const coordinate = info.location != null
        ? validCoordinate(info.location.latitude, info.location.longitude) ?? undefined
        : undefined;
      coordsRef.current.set(id, coordinate);
      return coordinate;
    } catch {
      // No GPS — the posting just goes out without a place.
      coordsRef.current.set(id, undefined);
      return undefined;
    }
  }, []);

  const locationForPost = useCallback((): string | undefined => {
    // The user's explicit edit always wins (clearing = post with no place).
    // Otherwise pass the resolved text when we have it, and when the field is
    // still empty/loading pass undefined so the use case auto-resolves — an
    // untouched empty field must never suppress the place.
    if (editedRef.current) return placeRef.current;
    return loadingRef.current || placeRef.current === '' ? undefined : placeRef.current;
  }, []);

  // A rescan is a fresh review: it must not inherit the last one's place, nor
  // the GPS cache, which is keyed to assets that may no longer be on screen.
  useEffect(() => {
    if (phase === 'loading' || phase === 'scanning') {
      coordsRef.current.clear();
      reset();
    }
  }, [phase, reset]);

  // Resolve the batch's place whenever the selection changes, so the user sees
  // (and can edit) the place before posting.
  useEffect(() => {
    if (phase !== 'done' || slots.length === 0) return;
    // Object property (not a local) so eslint doesn't flow-narrow it — the
    // cleanup closure flips it after this effect body has been analysed.
    const run = { cancelled: false };
    void (async (): Promise<void> => {
      setLoading(true);
      try {
        // All lookups in parallel — sequential awaits made the first
        // resolution take many seconds on iCloud-backed libraries.
        const probeGps = (ids: string[]): Promise<unknown> =>
          Promise.all(ids.map(id => resolveCoordinate(id)));
        const gpsOf = (ids: string[]): Coordinate[] =>
          ids.map(id => coordsRef.current.get(id)).filter((c): c is Coordinate => c != null);

        // Checked via a function call so lint doesn't flow-narrow across awaits.
        const isStale = (): boolean => run.cancelled || editedRef.current;

        await probeGps(slots);
        if (isStale()) return;
        let coordinates = gpsOf(slots);
        let src: PlaceSource = 'photos';
        if (__DEV__) console.log(`[place] GPS on ${coordinates.length}/${slots.length} selected photos`);

        // The selection has no GPS — borrow it from the rest of the scan.
        if (coordinates.length === 0) {
          const slotIds = new Set(slots);
          const restIds = [...batch, ...pool]
            .map(c => c.candidate.id)
            .filter(id => !slotIds.has(id));
          await probeGps(restIds);
          if (isStale()) return;
          coordinates = gpsOf(restIds);
          src = 'scan';
        }

        // Keep the coordinate, not just the name it resolved to. When the
        // selection had no GPS this is borrowed from the rest of the scan —
        // the same trip, minutes apart — which is a far better pin than
        // geocoding the label back to a city centre later.
        if (!run.cancelled) setGpsCoordinate(coordinates[0]);
        const resolved = coordinates.length > 0 ? await resolvePlaceForCoordinates(coordinates) : null;
        if (isStale()) return;

        if (__DEV__) console.log(`[place] resolved via ${resolved != null ? src : 'nothing'}: ${JSON.stringify(resolved)}`);
        setPlace(resolved ?? '');
        setSource(resolved != null ? src : 'none');
      } finally {
        if (!run.cancelled) setLoading(false);
      }
    })();
    return () => { run.cancelled = true; };
  }, [phase, slots, batch, pool, resolveCoordinate]);

  return {
    place,
    loading,
    source,
    gpsCoordinate,
    pickedCoordinate,
    // A posting has to land somewhere real on the map: a GPS fix from the batch
    // (or the surrounding scan), or a place the publisher picked.
    canPost: gpsCoordinate != null || pickedCoordinate != null,
    setPicked,
    reset,
    coordinateOf,
    resolveCoordinate,
    locationForPost,
  };
}
