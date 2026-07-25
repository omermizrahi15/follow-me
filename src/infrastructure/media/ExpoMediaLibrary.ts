import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { IMediaLibrary } from '../../domain/interfaces';
import type { ResolvePayload } from '../classifiers/GeminiPhotoClassifier';
import type { ResolveLocalUri, ResolveAssetLocation } from '../../domain/interfaces';
import { validCoordinate } from '../../domain/services/coordinate';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Assets fetched per pagination page. */
const PAGE_SIZE = 100;

/**
 * Reads recent photos from the device library via expo-media-library. Returns
 * lightweight PhotoCandidate value objects (no bytes) so the pure selection
 * logic stays device-agnostic. Bytes are loaded later, only for the photos we
 * actually classify.
 *
 * Uses `createdAfter` for OS-level date filtering and paginates through every
 * matching page, so the full lookback window is always scanned regardless of
 * how large the photo library is.
 */
export class ExpoMediaLibrary implements IMediaLibrary {
  async recentPhotos(lookbackDays: number): Promise<PhotoCandidate[]> {
    const granted = await this.ensurePermission();
    if (!granted) throw new Error('Photo library permission not granted');

    const cutoff = Date.now() - lookbackDays * MS_PER_DAY;
    const results: PhotoCandidate[] = [];
    let cursor: string | undefined = undefined;

    for (;;) {
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.photo,
        // Descending so we process newest photos first (matters when early-stop
        // kicks in during classification — we prefer recent over old).
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        createdAfter: cutoff,
        first: PAGE_SIZE,
        ...(cursor != null ? { after: cursor } : {}),
      });

      for (const asset of page.assets) {
        // Screenshots are never post-worthy — drop them at the source so they
        // don't reach classification, suggestions, or the cloud sync.
        if (asset.mediaSubtypes?.includes('screenshot')) continue;
        results.push({
          id: asset.id,
          uri: asset.uri,
          createdAt: new Date(asset.creationTime),
        });
      }

      if (!page.hasNextPage) break;
      cursor = page.endCursor;
    }

    return results;
  }

  private async ensurePermission(): Promise<boolean> {
    const current = await MediaLibrary.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await MediaLibrary.requestPermissionsAsync();
    return requested.granted;
  }
}

/**
 * Reads a library photo's bytes as base64 so it can be classified without first
 * uploading it. iOS `ph://` uris aren't readable directly, so resolve a local
 * file uri via the media library first. Wired into GeminiPhotoClassifier in the
 * composition root.
 */
export const expoResolvePayload: ResolvePayload = async candidate => {
  const uri = await expoResolveLocalUri(candidate);
  // ph:// URIs can't be read by FileSystem — only skip candidates that couldn't
  // be resolved to a local file:// path (e.g. iCloud-only photos not yet downloaded).
  if (!uri.startsWith('file://')) return null;
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return { id: candidate.id, base64, mimeType: 'image/jpeg' };
};

/**
 * Resolves a library uri to a readable local file uri (iOS `ph://` → `file://`),
 * used before uploading candidates to the cloud.
 */
export const expoResolveLocalUri: ResolveLocalUri = async candidate => {
  if (candidate.uri.startsWith('file://')) return candidate.uri;
  const info = await MediaLibrary.getAssetInfoAsync(candidate.id);
  return info.localUri ?? candidate.uri;
};

/**
 * Reads a candidate's GPS coordinate from its asset metadata (issue #23), or
 * null when the photo has no fix. `getAssetInfoAsync` exposes `location` on iOS
 * as *strings*, so validCoordinate coerces + rejects garbage (see coordinate.ts).
 * Called only for fresh (not-yet-synced) photos during the cloud sync, so the
 * extra per-asset lookup stays bounded.
 */
export const expoResolveAssetLocation: ResolveAssetLocation = async candidate => {
  const info = await MediaLibrary.getAssetInfoAsync(candidate.id);
  const loc = info.location;
  if (loc == null) return null;
  return validCoordinate(loc.latitude, loc.longitude);
};
