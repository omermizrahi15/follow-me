import type { Coordinate } from '../interfaces';
import { gpsFromExif } from './exifGps';
import type { GpsExif } from './exifGps';

/** The slice of a picker asset that coordinate resolution needs. */
export interface PickedAssetLike {
  assetId?: string | null;
  exif?: Record<string, unknown> | null;
}

export type AssetLocationLookup = (assetId: string) => Promise<Coordinate | null>;

/**
 * Best-effort coordinate for each picked asset, in input order (null where
 * unknown). EXIF is tried first (free), then the photo-library lookup — iOS's
 * photo picker (PHPicker) strips GPS EXIF for privacy, so on iOS most photos
 * only reveal their location through the library. A failed lookup yields null
 * for that photo, never an error: any subset with coordinates must still
 * produce a place suggestion.
 */
export async function coordinatesForPickedAssets(
  assets: readonly PickedAssetLike[],
  lookup: AssetLocationLookup,
): Promise<(Coordinate | null)[]> {
  return Promise.all(
    assets.map(async asset => {
      const fromExif = gpsFromExif(asset.exif as GpsExif | null | undefined);
      if (fromExif != null) return fromExif;
      if (asset.assetId == null) return null;
      try {
        return await lookup(asset.assetId);
      } catch {
        return null;
      }
    }),
  );
}
