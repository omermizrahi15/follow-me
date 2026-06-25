import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { IMediaLibrary } from '../../domain/interfaces';
import type { ResolvePayload } from '../classifiers/GeminiPhotoClassifier';
import type { ResolveLocalUri } from '../../domain/interfaces';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Upper bound on assets scanned per run, so a huge library can't hang the UI. */
const SCAN_LIMIT = 200;

/**
 * Reads recent photos from the device library via expo-media-library. Returns
 * lightweight PhotoCandidate value objects (no bytes) so the pure selection
 * logic stays device-agnostic. Bytes are loaded later, only for the photos we
 * actually classify.
 */
export class ExpoMediaLibrary implements IMediaLibrary {
  async recentPhotos(lookbackDays: number): Promise<PhotoCandidate[]> {
    const granted = await this.ensurePermission();
    if (!granted) throw new Error('Photo library permission not granted');

    const cutoff = Date.now() - lookbackDays * MS_PER_DAY;

    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.photo,
      sortBy: [MediaLibrary.SortBy.creationTime],
      first: SCAN_LIMIT,
    });

    return page.assets
      .filter(asset => asset.creationTime >= cutoff)
      .map(asset => ({
        id: asset.id,
        uri: asset.uri,
        createdAt: new Date(asset.creationTime),
      }));
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
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
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
