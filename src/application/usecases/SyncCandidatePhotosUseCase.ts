import type { CandidatePhoto } from '../../domain/entities/CandidatePhoto';
import type {
  IMediaLibrary,
  IStorageService,
  ICandidatePhotoRepository,
  ResolveLocalUri,
  ResolveAssetLocation,
} from '../../domain/interfaces';
import { mapInBatches, PHOTO_UPLOAD_BATCH_SIZE } from '../services/mapInBatches';

const identityResolve: ResolveLocalUri = candidate => Promise.resolve(candidate.uri);
/** Default: no GPS lookup (unit tests / environments without a media library). */
const noLocation: ResolveAssetLocation = () => Promise.resolve(null);

/**
 * Filename for the uploaded copy. Library uris can be odd (ph:// handles,
 * query params, no slash at all) — strip params, take the last path segment,
 * and fall back to the asset id when nothing usable remains.
 */
function deriveFilename(uri: string, assetId: string): string {
  const lastSegment = uri.split('?')[0]?.split('/').pop() ?? '';
  const safe = lastSegment.replace(/[^\w.-]/g, '');
  const fallback = `${assetId.replace(/[^\w.-]/g, '') || 'photo'}.jpg`;
  return safe.length > 0 ? safe : fallback;
}

/**
 * Uploads recent library photos to the cloud so the autonomous server job can
 * post them. Only photos not already synced are uploaded (deduped by asset id),
 * keeping the cloud set bounded to the lookback window. Runs on-device when the
 * app is open; pure orchestration, so it's unit-tested with fakes.
 */
export class SyncCandidatePhotosUseCase {
  constructor(
    private readonly mediaLibrary: IMediaLibrary,
    private readonly storage: IStorageService,
    private readonly candidateRepo: ICandidatePhotoRepository,
    private readonly resolveLocalUri: ResolveLocalUri = identityResolve,
    private readonly resolveLocation: ResolveAssetLocation = noLocation,
  ) {}

  /**
   * `shouldStop` is polled between batches so a sync that is already running
   * can be abandoned. The caller uses it to honour a cloud-photo wipe: without
   * it, the batches still in flight when the user hit "Remove my photos from
   * the cloud" would commit their rows *after* the delete and quietly bring
   * the cloud set back.
   *
   * `onProgress` reports `(uploaded, total)` — once with `(0, total)` before the
   * first batch, then after each commit. A first sync over a wide lookback is
   * minutes of work at three photos at a time, and without this the UI has
   * nothing to show for it but a spinner (which is how a working sync got
   * mistaken for a hung one and force-quit).
   */
  async execute(
    publisherId: string,
    lookbackDays: number,
    shouldStop?: () => Promise<boolean>,
    onProgress?: (uploaded: number, total: number) => void,
  ): Promise<CandidatePhoto[]> {
    const candidates = await this.mediaLibrary.recentPhotos(lookbackDays);
    const existing = await this.candidateRepo.existingAssetIds(publisherId);
    const fresh = candidates.filter(c => !existing.has(c.id));
    // Reported even when there is nothing to do, so the caller can distinguish
    // "finished, zero new photos" from "never started".
    onProgress?.(0, fresh.length);
    if (fresh.length === 0) return [];

    // Each batch is saved before the next starts, so an interrupted sync (app
    // backgrounded or killed) resumes where it left off instead of retrying —
    // and re-decoding — every photo on the next launch.
    return mapInBatches(
      fresh,
      PHOTO_UPLOAD_BATCH_SIZE,
      async (c): Promise<CandidatePhoto> => {
        const localUri = await this.resolveLocalUri(c);
        const url = await this.storage.upload(localUri, deriveFilename(c.uri, c.id));
        const location = c.location ?? (await this.resolveLocation(c));
        const row: CandidatePhoto = { publisherId, assetId: c.id, url, createdAt: c.createdAt };
        // Only set when present — exactOptionalPropertyTypes forbids `location: undefined`.
        if (location != null) row.location = location;
        return row;
      },
      {
        onBatch: async (batch, startIndex): Promise<void> => {
          await this.candidateRepo.saveMany(batch);
          // After the save, not before: progress means "in the cloud", which is
          // what the next sync's dedupe and the server's posting job both see.
          onProgress?.(startIndex + batch.length, fresh.length);
        },
        ...(shouldStop != null ? { shouldStop } : {}),
      },
    );
  }
}
