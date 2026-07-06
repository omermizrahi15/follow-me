import type { CandidatePhoto } from '../../domain/entities/CandidatePhoto';
import type {
  IMediaLibrary,
  IStorageService,
  ICandidatePhotoRepository,
  ResolveLocalUri,
} from '../../domain/interfaces';

const identityResolve: ResolveLocalUri = candidate => Promise.resolve(candidate.uri);

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
  ) {}

  async execute(publisherId: string, lookbackDays: number): Promise<CandidatePhoto[]> {
    const candidates = await this.mediaLibrary.recentPhotos(lookbackDays);
    const existing = await this.candidateRepo.existingAssetIds(publisherId);
    const fresh = candidates.filter(c => !existing.has(c.id));
    if (fresh.length === 0) return [];

    const rows = await Promise.all(
      fresh.map(async (c): Promise<CandidatePhoto> => {
        const localUri = await this.resolveLocalUri(c);
        const url = await this.storage.upload(localUri, deriveFilename(c.uri, c.id));
        return { publisherId, assetId: c.id, url, createdAt: c.createdAt };
      }),
    );

    await this.candidateRepo.saveMany(rows);
    return rows;
  }
}
