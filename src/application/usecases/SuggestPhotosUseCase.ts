import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IMediaLibrary, IPhotoClassifier, ISentPhotoTracker } from '../../domain/interfaces';
import { PhotoSelectionService, isSuggestablePhoto } from '../../domain/services/PhotoSelectionService';

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

/** What one on-demand top-up produced. */
export interface ClassifyMoreResult {
  /** Every photo the AI looked at this round, in classification order. */
  classified: PhotoClassification[];
  /** The subset worth offering to the publisher (see isSuggestablePhoto). */
  suggestions: PhotoClassification[];
  /**
   * How many candidates were spent. Includes ones that produced nothing (a
   * failed upload, an unreadable original) so the caller can drop them from
   * the queue instead of retrying the same duds on the next press.
   */
  consumed: number;
  /** The day's classification budget ran out mid-round — nothing more will work today. */
  quotaExhausted: boolean;
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
  /**
   * Candidates per on-demand classification wave. Matches the classifier's own
   * concurrency, so one "+" press costs a single parallel round-trip in the
   * common case where the AI likes at least one of the four.
   */
  private static readonly TOP_UP_WAVE = 4;

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

  /**
   * Photos from the same window the AI has not looked at yet, oldest first —
   * the queue the review screen's "+" slot works through.
   *
   * `execute` deliberately stops classifying at 2× the quota, so a normal scan
   * leaves most of the window untouched: this is how the publisher reaches it
   * when they want more photos than they configured.
   *
   * It rescans rather than remembering the tail of the last scan, because there
   * may not have been one — a batch delivered by push arrives pre-classified
   * from the server, and this device never looked at the library at all.
   *
   * @param known Candidate ids already on screen (batch + pool), so a photo the
   *              publisher can already see is never queued a second time.
   */
  async pendingCandidates(
    config: PublisherConfig,
    known: ReadonlySet<string> = new Set(),
  ): Promise<PhotoCandidate[]> {
    const [candidates, alreadySent] = await Promise.all([
      this.mediaLibrary.recentPhotos(config.lookbackDays),
      this.sentTracker.sentCandidateIds(config.publisherId),
    ]);
    // Same dedup as the scan, so bursts stay collapsed here too — the top-up
    // must not start offering the near-identical shots the batch skipped.
    return this.selection
      .deduplicateCandidates(candidates)
      .filter(c => !known.has(c.id) && !alreadySent.has(c.id));
  }

  /**
   * Classifies from the front of the queue until `want` photos worth suggesting
   * turn up, or the queue runs out.
   *
   * Works in fixed waves rather than handing the whole queue to the classifier
   * with a stop callback: a wave is consumed whether or not it yielded anything,
   * so a photo the classifier keeps failing on is retried at most once and the
   * "+" always makes progress instead of grinding over the same duds.
   */
  async classifyMore(
    candidates: readonly PhotoCandidate[],
    config: PublisherConfig,
    want = 1,
  ): Promise<ClassifyMoreResult> {
    const classified: PhotoClassification[] = [];
    const suggestions: PhotoClassification[] = [];
    let consumed = 0;
    let quotaExhausted = false;

    while (consumed < candidates.length && suggestions.length < want) {
      const wave = candidates.slice(consumed, consumed + SuggestPhotosUseCase.TOP_UP_WAVE);
      const results = await this.classifier.classify([...wave]);
      consumed += wave.length;
      classified.push(...results);
      suggestions.push(...results.filter(c => isSuggestablePhoto(c, config)));
      // A spent daily budget fails every remaining photo identically. Walking
      // the rest of the window would burn a wave per press and still come back
      // empty, so stop and let the caller say why (issue #81's lesson).
      if (this.classifier.quotaExhausted?.() === true) {
        quotaExhausted = true;
        break;
      }
    }

    return { classified, suggestions, consumed, quotaExhausted };
  }
}
