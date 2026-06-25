import type { CandidatePhoto } from '../../domain/entities/CandidatePhoto';
import type {
  IMediaLibrary,
  IStorageService,
  ICandidatePhotoRepository,
  ResolveLocalUri,
} from '../../domain/interfaces';

const identityResolve: ResolveLocalUri = candidate => Promise.resolve(candidate.uri);

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
        const filename = c.uri.split('/').pop() ?? `${c.id}.jpg`;
        const url = await this.storage.upload(localUri, filename);
        return { publisherId, assetId: c.id, url, createdAt: c.createdAt };
      }),
    );

    await this.candidateRepo.saveMany(rows);
    return rows;
  }
}
