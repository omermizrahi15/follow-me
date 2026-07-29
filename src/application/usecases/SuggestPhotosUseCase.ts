import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IMediaLibrary, IPhotoClassifier, ISentPhotoTracker } from '../../domain/interfaces';
import { PhotoSelectionService } from '../../domain/services/PhotoSelectionService';

export interface SuggestProgress {
  onScanning(): void;
  /**
   * Called once after the media scan and burst-dedup complete, before
   * classification starts. Lets the UI show "72 unique photos from 183 scanned."
   */
  onScanned(found: number, unique: number): void;
  /**
   * Called after each photo is classified.
   * `currentBatch` is the AI-selected set so far (not all classified photos) —
   * the UI can render this directly as the live preview.
   */
  onClassifying(index: number, total: number, currentBatch: PhotoClassification[]): void;
}

export interface SuggestResult {
  /** AI-selected initial batch (capped at photosPerPost, diversity-optimised). */
  batch: PhotoClassification[];
  /**
   * Classified photos that weren't chosen for the batch — available as
   * replacements if the user removes a batch photo. Sorted by quality descending.
   */
  pool: PhotoClassification[];
}

/**
 * An explicit window to scan instead of the config's now-anchored lookback.
 * Used by the history backfill (issue #81) to reconstruct one post per past
 * interval; live suggestions omit it and keep the lookback behaviour.
 */
export interface SuggestWindow {
  start: Date;
  /** Exclusive — adjacent backfill windows must not share a boundary photo. */
  end: Date;
}

/**
 * Builds the suggested batch for the publisher's next post: scan the library
 * window, classify each photo with AI, then apply the pure selection rules.
 * Orchestration only — all the selection logic lives in PhotoSelectionService.
 */
export class SuggestPhotosUseCase {
  constructor(
    private readonly mediaLibrary: IMediaLibrary,
    private readonly classifier: IPhotoClassifier,
    private readonly sentTracker: ISentPhotoTracker,
    private readonly selection: PhotoSelectionService = new PhotoSelectionService(),
  ) {}

  async execute(
    config: PublisherConfig,
    progress?: SuggestProgress,
    window?: SuggestWindow,
  ): Promise<SuggestResult> {
    progress?.onScanning();

    // Scan + already-sent in parallel so we have both before classification starts.
    const [candidates, alreadySent] = await Promise.all([
      window != null
        ? this.mediaLibrary.photosBetween(window.start, window.end)
        : this.mediaLibrary.recentPhotos(config.lookbackDays),
      this.sentTracker.sentCandidateIds(config.publisherId),
    ]);
    if (candidates.length === 0) return { batch: [], pool: [] };

    // Remove burst/near-duplicate shots before AI classification.
    const deduplicated = this.selection.deduplicateCandidates(candidates);
    progress?.onScanned(candidates.length, deduplicated.length);

    const accumulated: PhotoClassification[] = [];
    let currentBatch: PhotoClassification[] = [];

    await this.classifier.classify(
      deduplicated,
      (result, index, total) => {
        accumulated.push(result);
        currentBatch = this.selection.selectBatch(accumulated, config, alreadySent);
        progress?.onClassifying(index, total, currentBatch);
      },
      // Classify up to 2× the quota so the pool has meaningful replacements
      // when the user swaps out a photo, while keeping API calls bounded.
      () => accumulated.length >= config.photosPerPost * 2,
    );

    const batch = this.selection.selectBatch(accumulated, config, alreadySent);
    const batchIds = new Set(batch.map(c => c.candidate.id));
    // Pool = classified photos not chosen for the initial batch, sorted by quality.
    const pool = accumulated
      .filter(c => !batchIds.has(c.candidate.id) && !alreadySent.has(c.candidate.id))
      .sort(
        (a, b) =>
          b.quality - a.quality ||
          b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime(),
      );

    return { batch, pool };
  }
}
