import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { IStorageService, ResolveLocalUri } from '../../domain/interfaces';
import { mapInBatches, PHOTO_UPLOAD_BATCH_SIZE } from '../services/mapInBatches';

/**
 * Gets photos ready to send while the publisher is still looking at them, so
 * pressing Send only has to move bytes. The decode/downscale/re-encode used to
 * start at that press and was most of the wait.
 *
 * Best-effort throughout: anything this skips or fails on is simply prepared by
 * `upload` itself at send time, exactly as before.
 */
export class PrepareUploadsUseCase {
  constructor(
    private readonly storage: IStorageService,
    private readonly resolveLocalUri: ResolveLocalUri,
  ) {}

  async execute(photos: readonly PhotoCandidate[]): Promise<void> {
    const prepare = this.storage.prepare?.bind(this.storage);
    if (prepare == null) return;
    await mapInBatches(photos, PHOTO_UPLOAD_BATCH_SIZE, async photo => {
      // Already hosted — nothing to send, so nothing to prepare.
      if (photo.uri.startsWith('http')) return;
      try {
        const localUri = await this.resolveLocalUri(photo);
        await prepare(localUri, photo.uri.split('/').pop() ?? `${photo.id}.jpg`);
      } catch {
        // Send-time upload does the work itself.
      }
    });
  }
}
