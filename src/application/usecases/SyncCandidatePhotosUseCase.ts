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

  async execute(publisherId: string, lookbackDays: number): Promise<CandidatePhoto[]> {
    const candidates = await this.mediaLibrary.recentPhotos(lookbackDays);
    const existing = await this.candidateRepo.existingAssetIds(publisherId);
    const fresh = candidates.filter(c => !existing.has(c.id));
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
      batch => this.candidateRepo.saveMany(batch),
    );
  }
}
