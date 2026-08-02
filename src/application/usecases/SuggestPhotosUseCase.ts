import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
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
   * Everything else in the window that the publisher may swap in — AI-ranked
   * photos first, then the ones the classifier never got to.
   *
   * It deliberately includes UNCLASSIFIED photos. The pool used to hold only
   * classified ones, which meant a flaky or rate-limited classifier produced an
   * empty pool and the publisher could not change a single photo, even with
   * fifty sitting in that week. The AI's job is to pick the opening batch; it
   * should never be what decides whether a person may choose their own photo.
   */
  pool: PhotoClassification[];
  /** How many photos the classifier never returned a verdict on. */
  unclassifiedCount: number;
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
/**
 * A photo the classifier never judged, shaped so the UI can offer it like any
 * other. Quality 0 and category 'other' keep it behind everything the AI did
 * rank, without pretending to know anything about it.
 */
function unratedClassification(candidate: PhotoCandidate): PhotoClassification {
  return { candidate, category: 'other', confidence: 0, quality: 0, caption: '', scene: '' };
}

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
    if (candidates.length === 0) return { batch: [], pool: [], unclassifiedCount: 0 };

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

    // Classified leftovers, best first — these are the good replacements.
    const rated = accumulated
      .filter(c => !batchIds.has(c.candidate.id) && !alreadySent.has(c.candidate.id))
      .sort(
        (a, b) =>
          b.quality - a.quality ||
          b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime(),
      );

    // Then everything the classifier never reached: stopped early once the
    // quota was met, skipped because its original was still in iCloud, or lost
    // to a failing API. Unranked, so they sit behind the rated ones — but they
    // are in the window, so the publisher can reach them.
    const seen = new Set([...batchIds, ...rated.map(c => c.candidate.id)]);
    const unreached = deduplicated.filter(c => !seen.has(c.id) && !alreadySent.has(c.id));
    const unrated = unreached
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(unratedClassification);

    return {
      batch,
      pool: [...rated, ...unrated],
      unclassifiedCount: unreached.length,
    };
  }
}
