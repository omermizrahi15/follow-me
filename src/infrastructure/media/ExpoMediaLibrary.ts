import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { IMediaLibrary } from '../../domain/interfaces';
import type { ResolvePayload } from '../classifiers/GeminiPhotoClassifier';
import type { ResolveLocalUri, ResolveAssetLocation } from '../../domain/interfaces';
import { validCoordinate } from '../../domain/services/coordinate';
import { imageWidth } from './imageSize';
import { mapInBatches } from '../../application/services/mapInBatches';

/**
 * The file's size in bytes, or null when it cannot be read.
 *
 * Null, never zero. Zero is a real size that `burstRanking` would read as "no
 * detail at all" and rank last, so an unreadable file would be punished for
 * being unreadable.
 */
async function fileSize(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return info.exists && typeof info.size === 'number' && info.size > 0 ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * How long one photo may spend coming down from iCloud during classification.
 * Long enough that a normal fetch on a normal connection completes, short
 * enough that a stuck one costs a single suggestion rather than the stretch.
 */
const ICLOUD_FETCH_TIMEOUT_MS = 15_000;
/** Assets fetched per pagination page. */
const PAGE_SIZE = 100;

/**
 * How far `modificationTime` must sit past `creationTime` before it counts as
 * the publisher having edited the photo.
 *
 * The library stamps a modification time on import and on metadata writes, not
 * only on a real edit, and those land within a second or two of creation. A
 * minute is well clear of that and well under any actual "I went back and
 * cropped this" gap.
 */
const EDIT_MARGIN_MS = 60_000;

/**
 * Assets described at once. Small on purpose: each one is a library round trip,
 * and the failure this guards against is not slowness but the iOS watchdog.
 */
const DESCRIBE_BATCH_SIZE = 8;

/**
 * Photos are downscaled before being base64-encoded for classification.
 *
 * Gemini re-samples vision input to ~768px tiles, so full resolution buys no
 * accuracy — it only costs memory: base64 inflates the bytes by ~33%, then
 * `JSON.stringify` on the request body holds a second copy, and the classifier
 * keeps CONCURRENCY payloads in flight for the whole network round-trip. At
 * full res that is hundreds of MB of JS strings, which is how the iOS watchdog
 * ends up killing the app (issue #77). 1024px @ 0.7 lands around 100–200KB.
 */
const CLASSIFY_MAX_DIMENSION = 1024;
const CLASSIFY_JPEG_QUALITY = 0.7;

/**
 * Reads recent photos from the device library via expo-media-library. Returns
 * lightweight PhotoCandidate value objects (no bytes) so the pure selection
 * logic stays device-agnostic. Bytes are loaded later, only for the photos we
 * actually classify.
 *
 * Uses `createdAfter`/`createdBefore` for OS-level date filtering and paginates
 * through every matching page, so the full window is always scanned regardless
 * of how large the photo library is.
 */
export class ExpoMediaLibrary implements IMediaLibrary {
  async photosBetween(start: Date, end: Date): Promise<PhotoCandidate[]> {
    const granted = await this.ensurePermission();
    if (!granted) throw new Error('Photo library permission not granted');

    const startMs = start.getTime();
    const endMs = end.getTime();
    if (endMs <= startMs) return [];

    const results: PhotoCandidate[] = [];
    let cursor: string | undefined = undefined;

    for (;;) {
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.photo,
        // Descending so we process newest photos first (matters when early-stop
        // kicks in during classification — we prefer recent over old).
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        createdAfter: startMs,
        createdBefore: endMs,
        first: PAGE_SIZE,
        ...(cursor != null ? { after: cursor } : {}),
      });

      for (const asset of page.assets) {
        // Screenshots are never post-worthy — drop them at the source so they
        // don't reach classification, suggestions, or the cloud sync.
        if (asset.mediaSubtypes?.includes('screenshot')) continue;
        // The OS filters are inclusive on some platforms; re-check here so
        // adjacent backfill windows can never both claim a boundary photo.
        if (asset.creationTime < startMs || asset.creationTime >= endMs) continue;
        results.push({
          id: asset.id,
          uri: asset.uri,
          createdAt: new Date(asset.creationTime),
          // Free with the page — no per-asset lookup. What lets a burst be
          // ranked on file density rather than on the clock (see burstRanking).
          width: asset.width,
          height: asset.height,
          // An edit is the publisher saying they cared about this frame. The
          // library stamps `modificationTime` on import as well as on edit, so
          // only a modification comfortably AFTER creation counts — otherwise
          // every photo in the library reads as edited.
          ...(asset.modificationTime - asset.creationTime > EDIT_MARGIN_MS
            ? { editedAt: new Date(asset.modificationTime) }
            : {}),
        });
      }

      if (!page.hasNextPage) break;
      cursor = page.endCursor;
    }

    return results;
  }

  /**
   * File size and favourite flag for the photos that need them.
   *
   * One `getAssetInfoAsync` per photo, which is why the caller hands over only
   * burst members rather than the window. Batched, because a Promise.all over
   * even a hundred assets is the shape of unbounded concurrent work that has
   * watchdog-killed this app twice (issues #77, #97).
   *
   * `shouldDownloadFromNetwork: false` is load-bearing: without it this would
   * pull every iCloud original down just to read its size, turning a metadata
   * pass into a multi-gigabyte one. A photo that lives only in iCloud simply
   * answers with less, and ranks on what is left.
   */
  async describeAssets(candidates: readonly PhotoCandidate[]): Promise<PhotoCandidate[]> {
    return mapInBatches(candidates, DESCRIBE_BATCH_SIZE, async candidate => {
      try {
        const info = await MediaLibrary.getAssetInfoAsync(candidate.id, {
          shouldDownloadFromNetwork: false,
        });
        const byteSize = await fileSize(info.localUri ?? info.uri);
        return {
          ...candidate,
          ...(info.isFavorite === true ? { isFavorite: true } : {}),
          ...(byteSize != null ? { byteSize } : {}),
        };
      } catch {
        // One unreadable asset must not cost the whole pass. It ranks on what
        // the scan already knew, which is what every photo did before this.
        return candidate;
      }
    });
  }

  private async ensurePermission(): Promise<boolean> {
    const current = await MediaLibrary.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await MediaLibrary.requestPermissionsAsync();
    return requested.granted;
  }
}

/**
 * Reads a library photo as a downscaled base64 JPEG so it can be classified
 * without first uploading it. iOS `ph://` uris aren't readable directly, so
 * resolve a local file uri via the media library first. Wired into
 * GeminiPhotoClassifier in the composition root.
 *
 * Returns null to skip the photo when it can't be prepared — the classifier
 * just moves on to the next candidate. Falling back to the full-resolution
 * bytes would reintroduce the memory spike this downscale exists to avoid.
 */
export const expoResolvePayload: ResolvePayload = async candidate => {
  // Do fetch iCloud originals — skipping them was worse than waiting. Under
  // "Optimise iPhone Storage" most originals live in iCloud, so refusing to
  // download left only the handful cached on device and every reconstructed
  // post came back with a single photo. A bounded wait keeps the batches full
  // without letting one pathological fetch stall the stretch.
  const uri = await resolveLocalUri(candidate, true, ICLOUD_FETCH_TIMEOUT_MS);
  // ph:// URIs can't be read by FileSystem — only skip candidates that couldn't
  // be resolved to a local file:// path (e.g. iCloud-only photos not yet downloaded).
  if (!uri.startsWith('file://')) return null;
  try {
    const width = await imageWidth(uri);
    const actions = width > CLASSIFY_MAX_DIMENSION ? [{ resize: { width: CLASSIFY_MAX_DIMENSION } }] : [];
    // `base64: true` hands back the encoded string directly, so the downscaled
    // copy never has to be read off disk a second time.
    const out = await manipulateAsync(uri, actions, {
      compress: CLASSIFY_JPEG_QUALITY,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (out.base64 == null) return null;
    return { id: candidate.id, base64: out.base64, mimeType: 'image/jpeg' };
  } catch {
    return null;
  }
};

/**
 * Resolves a library uri to a readable local file uri (iOS `ph://` → `file://`).
 *
 * `download` decides what happens for a photo whose original lives in iCloud
 * rather than on the device — the normal state under "Optimise iPhone Storage".
 * `getAssetInfoAsync` defaults to downloading it, which is right before an
 * upload (we need the bytes) and badly wrong while classifying: a backfill
 * would pull hundreds of full-resolution originals over the network and appear
 * to hang for minutes on the first stretch.
 */
export async function resolveLocalUri(
  candidate: PhotoCandidate,
  download: boolean,
  timeoutMs?: number,
): Promise<string> {
  if (candidate.uri.startsWith('file://')) return candidate.uri;

  const lookup = MediaLibrary.getAssetInfoAsync(candidate.id, {
    shouldDownloadFromNetwork: download,
  });

  // Unbounded is right when the caller needs the bytes at any cost (upload).
  // For classification a slow photo is not worth an open-ended wait: returning
  // the unusable ph:// uri makes the caller skip it and move to the next.
  if (timeoutMs == null) return (await lookup).localUri ?? candidate.uri;

  // The timer is cleared whichever side wins. Left dangling it would keep one
  // pending timeout alive per photo for the full window — enough to hold the
  // event loop open and, in tests, to stop the worker exiting.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      lookup,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    return info?.localUri ?? candidate.uri;
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

/** Upload path: the bytes are the point, so an iCloud original is worth waiting for. */
export const expoResolveLocalUri: ResolveLocalUri = candidate => resolveLocalUri(candidate, true);

/**
 * Reads a candidate's GPS coordinate from its asset metadata (issue #23), or
 * null when the photo has no fix. `getAssetInfoAsync` exposes `location` on iOS
 * as *strings*, so validCoordinate coerces + rejects garbage (see coordinate.ts).
 * Called only for fresh (not-yet-synced) photos during the cloud sync, so the
 * extra per-asset lookup stays bounded.
 */
export const expoResolveAssetLocation: ResolveAssetLocation = async candidate => {
  // Metadata only — a coordinate never justifies pulling the original down.
  const info = await MediaLibrary.getAssetInfoAsync(candidate.id, {
    shouldDownloadFromNetwork: false,
  });
  const loc = info.location;
  if (loc == null) return null;
  return validCoordinate(loc.latitude, loc.longitude);
};
