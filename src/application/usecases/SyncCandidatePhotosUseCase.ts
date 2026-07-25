import type { CandidatePhoto } from '../../domain/entities/CandidatePhoto';
import type {
  IMediaLibrary,
  IStorageService,
  ICandidatePhotoRepository,
  ResolveLocalUri,
  ResolveAssetLocation,
} from '../../domain/interfaces';

const identityResolve: ResolveLocalUri = candidate => Promise.resolve(candidate.uri);
/** Default: no GPS lookup (unit tests / environments without a media library). */
const noLocation: ResolveAssetLocation = () => Promise.resolve(null);

/**
 * Uploads run in small batches, never all at once: each upload decodes the
 * full-resolution photo into a native bitmap (tens of MB) to downscale it, so
 * unbounded concurrency over a first sync's whole lookback window spikes RAM
 * by gigabytes and the iOS watchdog kills the app at launch (staging crash,
 * WatchdogTermination in Sentry).
 */
const UPLOAD_BATCH_SIZE = 3;

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
    const rows: CandidatePhoto[] = [];
    for (let i = 0; i < fresh.length; i += UPLOAD_BATCH_SIZE) {
      const batch = await Promise.all(
        fresh.slice(i, i + UPLOAD_BATCH_SIZE).map(async (c): Promise<CandidatePhoto> => {
          const localUri = await this.resolveLocalUri(c);
          const url = await this.storage.upload(localUri, deriveFilename(c.uri, c.id));
          const location = c.location ?? (await this.resolveLocation(c));
          const row: CandidatePhoto = { publisherId, assetId: c.id, url, createdAt: c.createdAt };
          // Only set when present — exactOptionalPropertyTypes forbids `location: undefined`.
          if (location != null) row.location = location;
          return row;
        }),
      );
      await this.candidateRepo.saveMany(batch);
      rows.push(...batch);
    }
    return rows;
  }
}
