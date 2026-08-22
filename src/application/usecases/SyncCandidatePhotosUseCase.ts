import type { CandidatePhoto } from '../../domain/entities/CandidatePhoto';
import type {
  IMediaLibrary,
  IStorageService,
  ICandidatePhotoRepository,
  ISentPhotoTracker,
  ResolveLocalUri,
  ResolveAssetLocation,
} from '../../domain/interfaces';
import { mapInBatches, PHOTO_UPLOAD_BATCH_SIZE } from '../services/mapInBatches';
import { windowStartMs } from '../../domain/services/suggestionWindow';

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
    /**
     * Supplies the last-post anchor so the uploaded set covers the same stretch
     * the on-device suggestion does. Optional: without it the sync falls back to
     * the plain lookback, which is what it always did.
     */
    private readonly sentTracker?: ISentPhotoTracker,
  ) {}

  /**
   * `shouldStop` is polled before each photo so a sync that is already running
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
    // The same stretch the suggestion scan reads, so an overdue publisher's
    // extra days exist in the cloud too. While this was a plain now-anchored
    // lookback, the phone offered those photos and the server's autonomous post
    // could not see them — the same bug, fixed on only one side.
    const now = Date.now();
    const newestPosted = await this.sentTracker?.newestPostedPhotoAt(publisherId);
    const start = windowStartMs({
      now,
      lookbackDays,
      newestPostedPhotoAt: newestPosted?.getTime() ?? null,
    });
    const candidates = await this.mediaLibrary.photosBetween(new Date(start), new Date(now));
    const existing = await this.candidateRepo.existingAssetIds(publisherId);
    const fresh = candidates.filter(c => !existing.has(c.id));
    // Reported even when there is nothing to do, so the caller can distinguish
    // "finished, zero new photos" from "never started".
    onProgress?.(0, fresh.length);
    if (fresh.length === 0) return [];

    // One photo failing must not cost the run. A weak connection drops
    // individual uploads all the time, and letting the first one abort
    // `mapInBatches` meant a sync that died on photo 90 of 100 reported failure
    // and left the other 99 unsynced — even though 89 had already landed
    // (issue #145). Failures are collected instead, and the photo simply isn't
    // in `existingAssetIds` next time, so the next run retries exactly it.
    let lastFailure: unknown = null;
    let failed = 0;

    // Each upload is saved before its slot takes another photo, so an
    // interrupted sync (app backgrounded or killed) resumes where it left off
    // instead of retrying — and re-decoding — every photo on the next launch.
    const results = await mapInBatches(
      fresh,
      PHOTO_UPLOAD_BATCH_SIZE,
      async (c): Promise<CandidatePhoto | null> => {
        try {
          const localUri = await this.resolveLocalUri(c);
          const url = await this.storage.upload(localUri, deriveFilename(c.uri, c.id));
          const location = c.location ?? (await this.resolveLocation(c));
          const row: CandidatePhoto = { publisherId, assetId: c.id, url, createdAt: c.createdAt };
          // Only set when present — exactOptionalPropertyTypes forbids `location: undefined`.
          if (location != null) row.location = location;
          return row;
        } catch (e: unknown) {
          lastFailure = e;
          failed++;
          return null;
        }
      },
      {
        onCommit: async (rows, done): Promise<void> => {
          const saved = rows.filter((r): r is CandidatePhoto => r != null);
          if (saved.length > 0) await this.candidateRepo.saveMany(saved);
          // After the save, not before: progress means "in the cloud", which is
          // what the next sync's dedupe and the server's posting job both see.
          // `done` counts committed results rather than positions — uploads
          // finish in whatever order the network returns them — and the ones
          // that failed are subtracted, so the number never claims a photo that
          // isn't there.
          onProgress?.(done - failed, fresh.length);
        },
        ...(shouldStop != null ? { shouldStop } : {}),
      },
    );

    const uploaded = results.filter((r): r is CandidatePhoto => r != null);
    // Nothing at all got through: that is not a partial failure, it is a failed
    // sync, and it has to be reported as one. Swallowing it would tell the
    // server this device is syncing fine and leave the posting job waiting for
    // photos that are never coming (issue #97).
    if (uploaded.length === 0 && failed > 0) throw lastFailure;
    return uploaded;
  }
}
