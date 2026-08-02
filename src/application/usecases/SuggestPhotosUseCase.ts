import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type {
  IClassificationStore,
  IMediaLibrary,
  IPhotoClassifier,
  ISentPhotoTracker,
} from '../../domain/interfaces';
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
  /**
   * Fired as soon as there are enough grades to show a real post, while the
   * rest of the window is still being graded.
   *
   * Grading the whole window is what stops every swap being a live network
   * round — but it takes far longer than grading 20 photos, and the publisher
   * should not sit through it. The UI switches to the finished state here and
   * keeps deepening the pool from later `onClassifying` calls.
   */
  onBatchReady?(batch: PhotoClassification[], pool: PhotoClassification[]): void;
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

  /**
   * Most photos one scan will grade. The window is graded in full below this,
   * so this only bites on a wide window over a heavy month — and because
   * grades are remembered, a capped scan is a pace rather than a loss: the
   * ungraded tail is picked up by the next scan instead of being re-bought.
   *
   * Sits under the classify function's own per-user daily quota so a single
   * scan cannot spend the whole day's budget.
   */
  private static readonly MAX_PER_SCAN = 300;

  constructor(
    private readonly mediaLibrary: IMediaLibrary,
    private readonly classifier: IPhotoClassifier,
    private readonly sentTracker: ISentPhotoTracker,
    private readonly selection: PhotoSelectionService = new PhotoSelectionService(),
    /**
     * Remembers grades between scans. Optional so tests and the history
     * backfill can run without one; absent simply means every scan pays again.
     */
    private readonly grades?: IClassificationStore,
    private readonly maxPerScan: number = SuggestPhotosUseCase.MAX_PER_SCAN,
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

    // Grades already bought for these photos — free, and the reason the whole
    // window is affordable at all. `deduplicateCandidates` returns oldest-first
    // (burst dedup keeps the first shot of each group); grading walks the other
    // way so a capped or quota-stopped run always spends its budget on the most
    // recent photos, which are the ones worth posting.
    const remembered =
      (await this.grades?.load(deduplicated.map(c => c.id))) ??
      new Map<string, PhotoClassification>();
    const newestFirst = [...deduplicated].reverse();
    // The backfill reconstructs one post per past interval and never swaps, so
    // it keeps the old shallow grading — grading every window in full would
    // multiply its cost by the number of intervals for photos nobody browses.
    const limit = window != null ? config.photosPerPost * 2 : this.maxPerScan;
    const ungraded = newestFirst.filter(c => !remembered.has(c.id)).slice(0, limit);

    // Cached grades count towards the batch from the very first render, so a
    // rescan of an already-graded window shows a full post with no AI at all.
    const accumulated: PhotoClassification[] = newestFirst
      .map(c => remembered.get(c.id))
      .filter((c): c is PhotoClassification => c != null);

    const readyAt = config.photosPerPost * 2;
    let announced = false;
    const announceIfReady = (): void => {
      if (announced || accumulated.length < readyAt) return;
      announced = true;
      progress?.onBatchReady?.(...this.split(accumulated, config, alreadySent));
    };
    announceIfReady();

    const freshlyGraded: PhotoClassification[] = [];
    await this.classifier.classify(ungraded, (result, index, total) => {
      accumulated.push(result);
      freshlyGraded.push(result);
      progress?.onClassifying(
        index,
        total,
        this.selection.selectBatch(accumulated, config, alreadySent),
      );
      announceIfReady();
    });

    // Written once at the end rather than per photo: a scan is hundreds of
    // grades, and re-serialising the whole blob each time would cost more than
    // the classification it is saving.
    if (freshlyGraded.length > 0) await this.grades?.save(freshlyGraded);

    const [batch, pool] = this.split(accumulated, config, alreadySent);
    return { batch, pool };
  }

  /**
   * Splits everything graded so far into the post itself and the ranked
   * remainder. The pool is every other graded photo, best first — with the
   * whole window graded this is what makes a swap a lookup instead of a wait.
   */
  private split(
    accumulated: PhotoClassification[],
    config: PublisherConfig,
    alreadySent: Set<string>,
  ): [PhotoClassification[], PhotoClassification[]] {
    const batch = this.selection.selectBatch(accumulated, config, alreadySent);
    const batchIds = new Set(batch.map(c => c.candidate.id));
    const pool = accumulated
      .filter(c => !batchIds.has(c.candidate.id) && !alreadySent.has(c.candidate.id))
      .sort(
        (a, b) =>
          b.quality - a.quality ||
          b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime(),
      );
    return [batch, pool];
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
    // Reversed for the same reason the scan grades newest-first: whatever the
    // publisher gets next should come from the recent end of the window.
    return this.selection
      .deduplicateCandidates(candidates)
      .reverse()
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
      // A wave the scan already graded (cap reached, or the photo arrived after
      // it) is answered from memory — no call, no quota.
      const remembered =
        (await this.grades?.load(wave.map(c => c.id))) ?? new Map<string, PhotoClassification>();
      const fresh = wave.filter(c => !remembered.has(c.id));
      const graded = fresh.length > 0 ? await this.classifier.classify(fresh) : [];
      if (graded.length > 0) await this.grades?.save(graded);
      const results = [
        ...wave.map(c => remembered.get(c.id)).filter((c): c is PhotoClassification => c != null),
        ...graded,
      ];
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
