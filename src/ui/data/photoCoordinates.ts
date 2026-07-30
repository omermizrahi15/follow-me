import * as MediaLibrary from 'expo-media-library';
import type { Coordinate } from '../../domain/interfaces';
import { validCoordinate } from '../../domain/services/coordinate';

/**
 * Asset id → GPS fix, or `undefined` for "probed, has no fix". Misses are
 * cached too: on an iCloud-backed library `getAssetInfoAsync` is slow, and the
 * history backfill probes the same photos again on every re-render of the
 * review timeline.
 *
 * Module-level and never evicted — bounded in practice by the photos one
 * backfill run touches.
 */
const cache = new Map<string, Coordinate | undefined>();

/**
 * Where a library photo was taken, or undefined when it has no fix. iOS returns
 * `location` as strings, which is why the raw values go through validCoordinate
 * (see coordinate.ts) rather than being trusted as numbers.
 */
export async function coordinateFor(assetId: string): Promise<Coordinate | undefined> {
  const hit = cache.get(assetId);
  if (hit !== undefined || cache.has(assetId)) return hit;

  let resolved: Coordinate | undefined;
  try {
    // Metadata only: never pull an iCloud original down just to read its GPS.
    const info = await MediaLibrary.getAssetInfoAsync(assetId, {
      shouldDownloadFromNetwork: false,
    });
    resolved =
      info.location != null
        ? validCoordinate(info.location.latitude, info.location.longitude) ?? undefined
        : undefined;
  } catch {
    // Not a library asset (a remote url from the push cache), or unreadable.
    resolved = undefined;
  }
  cache.set(assetId, resolved);
  return resolved;
}

/**
 * GPS for many photos at once, dropping the ones without a fix. Probes run in
 * parallel — sequential awaits made place resolution take many seconds on
 * iCloud-backed libraries.
 */
export async function coordinatesFor(assetIds: string[]): Promise<Coordinate[]> {
  const found = await Promise.all(assetIds.map(coordinateFor));
  return found.filter((c): c is Coordinate => c != null);
}
