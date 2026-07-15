import * as MediaLibrary from 'expo-media-library';
import type { Coordinate } from '../../domain/interfaces';
import { validCoordinate } from '../../domain/services/coordinate';
import type { AssetLocationLookup } from '../../domain/services/pickedAssetCoordinates';

// Asset locations never change; cache across screens so the place-preview
// effect and the share handler don't both hit the (iCloud-backed, slow)
// library for the same photo.
const cache = new Map<string, Coordinate | null>();

/** Photo-library location for an asset, or null when absent/denied/invalid. */
export const mediaLibraryAssetLocation: AssetLocationLookup = async assetId => {
  const cached = cache.get(assetId);
  if (cached !== undefined) return cached;
  let location: Coordinate | null = null;
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    location =
      info.location != null
        ? validCoordinate(info.location.latitude, info.location.longitude)
        : null;
  } catch {
    location = null;
  }
  cache.set(assetId, location);
  return location;
};
