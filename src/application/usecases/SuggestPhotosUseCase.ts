import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type {
  FaceReference,
  IClassificationStore,
  IMediaLibrary,
  IPhotoClassifier,
  ISentPhotoTracker,
} from '../../domain/interfaces';
import { PhotoSelectionService, isSuggestablePhoto } from '../../domain/services/PhotoSelectionService';
import { windowStartMs } from '../../domain/services/suggestionWindow';

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

/**
 * What a scan actually managed to do — not what it set out to do.
 *
 * "AI picked 10 photos from 109 scanned" was true and useless: 109 counts what
 * the library returned, and a photo whose original still lives in iCloud is
 * dropped mid-classification without a trace. A publisher whose window barely
 * graded therefore saw a confident headline followed by "no more photos", with
 * nothing anywhere connecting the two. These numbers are what makes the
 * difference sayable.
 */
export interface SuggestStats {
  /** Photos the library returned for the window. */
  scanned: number;
  /**
   * How many distinct moments those photos cover — bursts counted once.
   *
   * Purely descriptive now. It used to be the count that survived dedup, i.e.
   * the only photos that would ever be graded or offered; the rest were gone.
   * Every photo in the window is reachable today, so this says "you shot 37
   * frames across 12 moments", not "25 were thrown away".
   */
  unique: number;
  /** Grades in hand at the end (fresh + remembered from earlier scans). */
  graded: number;
  /**
   * Photos the AI was asked about that produced nothing — an iCloud original
   * that didn't come down in time, or an unreadable file. They are neither in
   * the batch nor the pool, and they are the usual reason a big window yields
   * a thin one.
   *
   * A *failed classifier* is deliberately not in here: that aborts the scan
   * with an error instead of quietly shrinking the result, because "the AI is
   * down" and "these particular photos wouldn't load" call for different
   * things from the publisher.
   */
  unreadable: number;
  /** The day's classification budget ran out during the scan. */
  quotaExhausted: boolean;
  /**
   * The scan stopped short because the AI provider was throttling us. Same
   * visible effect as a quota wall — fewer photos graded than found — but it
   * lifts in seconds, so the shortfall is worth re-running now rather than
   * tomorrow (issue #141).
   */
  rateLimited: boolean;
}

export interface SuggestResult {
  /** AI-selected initial batch (capped at photosPerPost, diversity-optimised). */
  batch: PhotoClassification[];
  /**
   * Classified photos that weren't chosen for the batch — available as
   * replacements if the user removes a batch photo. Sorted by quality descending.
   */
  pool: PhotoClassification[];
  stats: SuggestStats;
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
  /**
   * The round stopped because the AI provider was throttling us, not because
   * the day's budget is gone. Reported separately because the right advice is
   * the opposite: wait a moment and try again, rather than come back tomorrow.
   */
  rateLimited: boolean;
  /**
   * The round stopped at its wave limit with candidates still queued, rather
   * than because the window was spent. The distinction is the whole point of
   * the limit: "nothing found yet" must not be reported as "nothing exists".
   */
  cappedEarly: boolean;
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

function emptyStats(scanned: number, unique: number): SuggestStats {
  return { scanned, unique, graded: 0, unreadable: 0, quotaExhausted: false, rateLimited: false };
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
   * Waves one top-up may spend before handing control back.
   *
   * Without a limit this walked the *entire* remaining window looking for one
   * suggestable photo. On a library kept in iCloud that is a 15-second fetch
   * attempt per photo: a single "Other" tap could sit there for minutes and
   * then report the window exhausted, which is how one press managed to be slow,
   * lose the photo it was replacing, and grey out the "+" all at once.
   *
   * Three waves is a couple of seconds of work and twelve real chances — enough
   * that a normal press still answers on the first round, while a barren
   * stretch costs a wait the publisher can interrupt rather than an open-ended
   * one they cannot.
   */
  private static readonly TOP_UP_MAX_WAVES = 3;

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
    /**
     * Supplies the publisher's profile photo, which is the face "photos of me"
     * matches against (issue #137). Injected rather than reached for directly
     * so this use case keeps knowing nothing about profiles; absent — as in
     * tests and any caller that doesn't care — simply means the question is
     * never asked.
     */
    private readonly avatarUrl?: (publisherId: string) => Promise<string | null>,
  ) {}

  /**
   * The face to look for during a run, or null to not look.
   *
   * Null whenever the preference is off, which is what keeps the profile photo
   * out of every classify request a publisher who didn't ask for this makes. A
   * publisher with the preference on but no avatar also lands here — the UI
   * hides the control in that case, so it means a photo was removed after the
   * setting was saved, and the ranking degrades to plain quality rather than
   * declaring every photo publisher-free.
   */
  private async faceReference(config: PublisherConfig): Promise<FaceReference | null> {
    if (config.photosOfMe === 'off') return null;
    const url = await this.avatarUrl?.(config.publisherId).catch(() => null);
    return url != null && url !== '' ? { url } : null;
  }

  /** The cache key for a run's face — see IClassificationStore.load. */
  private static referenceKey(reference: FaceReference | null): string {
    return reference?.url ?? '';
  }

  /**
   * The config the selection rules should actually run under.
   *
   * Identical to the stored one except when the preference is on and no face
   * could be resolved — no avatar, or a profile fetch that simply failed. Every
   * photo then reads `containsPublisher: false`, and `only` would filter the
   * whole window away and hand back an empty post with nothing to explain it.
   * Downgrading to `off` for the run degrades to plain quality ranking instead,
   * and the next run picks the preference back up once the profile loads.
   */
  private static selectionConfig(
    config: PublisherConfig,
    reference: FaceReference | null,
  ): PublisherConfig {
    return reference == null ? config.withPhotosOfMe('off') : config;
  }

  /**
   * The stretch a live suggestion draws from: everything since the last post,
   * but never less than the configured lookback.
   *
   * `min`, not `max`, is the whole point. The lookback is a floor — a weekly
   * publisher always sees at least their week — and the last post extends it
   * backwards when they are overdue. Anchoring to `now - lookbackDays` alone
   * meant a missed reminder silently swallowed the days between: open the app
   * two days late and the two oldest days of the window had rolled out of it,
   * taking exactly the photos the reminder was sent about.
   *
   * Clamped to MAX_LOOKBACK_DAYS so a long absence can't open an unbounded scan.
   */
  private async liveWindow(config: PublisherConfig, now: number): Promise<SuggestWindow> {
    const newestPosted = await this.sentTracker.newestPostedPhotoAt(config.publisherId);
    const start = windowStartMs({
      now,
      lookbackDays: config.lookbackDays,
      newestPostedPhotoAt: newestPosted?.getTime() ?? null,
    });
    return { start: new Date(start), end: new Date(now) };
  }

  /**
   * Whether anything has been shot since `since` — the cheap check that decides
   * if a cached batch still describes the library.
   *
   * Metadata only: no grading, no bytes, no iCloud fetch. That is what makes it
   * affordable on every open, and it is the difference between a cache that
   * saves a scan and one that hides the photos the publisher just took. A
   * cached batch was previously served for a flat six hours, so a morning's
   * shooting was invisible until the afternoon — the "it loads photos from
   * before and can't load new ones" report.
   */
  async hasPhotosSince(since: Date): Promise<boolean> {
    const now = new Date();
    if (since.getTime() >= now.getTime()) return false;
    const shot = await this.mediaLibrary.photosBetween(since, now);
    return shot.length > 0;
  }

  async execute(
    config: PublisherConfig,
    progress?: SuggestProgress,
    window?: SuggestWindow,
  ): Promise<SuggestResult> {
    progress?.onScanning();

    const scanWindow = window ?? (await this.liveWindow(config, Date.now()));

    // Scan + already-sent in parallel so we have both before classification starts.
    const [candidates, alreadySent] = await Promise.all([
      this.mediaLibrary.photosBetween(scanWindow.start, scanWindow.end),
      this.sentTracker.sentCandidateIds(config.publisherId),
    ]);
    if (candidates.length === 0) {
      return { batch: [], pool: [], stats: emptyStats(0, 0) };
    }

    // One photo per burst first, then the rest — an ordering, not a filter.
    // Nothing is discarded: a photo the old dedup dropped was unreachable
    // forever, because the top-up queue applied the same rule.
    const prioritised = this.selection.gradingOrder(candidates);
    progress?.onScanned(candidates.length, this.selection.distinctMoments(candidates));

    const reference = await this.faceReference(config);
    const referenceKey = SuggestPhotosUseCase.referenceKey(reference);
    const rules = SuggestPhotosUseCase.selectionConfig(config, reference);

    // Grades already bought for these photos — free, and the reason the whole
    // window is affordable at all. Only grades bought while looking for the
    // same face count: switching "photos of me" on buys the window again, once,
    // because no earlier grade knows who is in the picture.
    const remembered =
      (await this.grades?.load(prioritised.map(c => c.id), referenceKey)) ??
      new Map<string, PhotoClassification>();
    // The backfill reconstructs one post per past interval and never swaps, so
    // it keeps the old shallow grading — grading every window in full would
    // multiply its cost by the number of intervals for photos nobody browses.
    const limit = window != null ? config.photosPerPost * 2 : this.maxPerScan;
    // `prioritised` is already leaders-then-followers, each newest-first, so a
    // run cut short by this cap or by the daily quota spends what it has on
    // recent, distinct moments — and the burst siblings it skipped are still
    // reachable, either from a later scan or from the "+".
    const ungraded = prioritised.filter(c => !remembered.has(c.id)).slice(0, limit);

    // Cached grades count towards the batch from the very first render, so a
    // rescan of an already-graded window shows a full post with no AI at all.
    const accumulated: PhotoClassification[] = prioritised
      .map(c => remembered.get(c.id))
      .filter((c): c is PhotoClassification => c != null);

    const readyAt = config.photosPerPost * 2;
    let announced = false;
    const announceIfReady = (): void => {
      if (announced || accumulated.length < readyAt) return;
      announced = true;
      progress?.onBatchReady?.(...this.split(accumulated, rules, alreadySent));
    };
    // Announcing is the end of the reveal, not the start of it: until it fires,
    // the screen renders the batch growing photo by photo out of
    // `onClassifying`, and afterwards it renders a fixed, swappable post. So
    // this pre-announce only happens when there is genuinely nothing to grade.
    //
    // It used to fire unconditionally, and remembered grades then made "nothing
    // to reveal" the normal case for the wrong reason: a window that was only
    // PART graded already had enough in hand to clear the threshold, so the run
    // announced at once and everything it graded afterwards appeared without
    // ever being seen to arrive. Grading looked like a step the app skipped.
    if (ungraded.length === 0) announceIfReady();

    const freshlyGraded: PhotoClassification[] = [];
    try {
      await this.classifier.classify(
        ungraded,
        (result, index, total) => {
          accumulated.push(result);
          freshlyGraded.push(result);
          progress?.onClassifying(
            index,
            total,
            this.selection.selectBatch(accumulated, rules, alreadySent),
          );
          announceIfReady();
        },
        undefined,
        reference,
      );
    } finally {
      // Written once at the end rather than per photo: a scan is hundreds of
      // grades, and re-serialising the whole blob each time would cost more
      // than the classification it is saving.
      //
      // In a `finally` because a classifier failure aborts the scan, and the
      // grades bought before it are still real — dropping them would make the
      // retry pay for them a second time. What must never be written is a
      // *guess*: the classifier throws rather than inventing a grade, so
      // nothing in here is a placeholder.
      if (freshlyGraded.length > 0) await this.grades?.save(freshlyGraded, referenceKey);
    }

    const [batch, pool] = this.split(accumulated, rules, alreadySent);
    const quotaExhausted = this.classifier.quotaExhausted?.() === true;
    const rateLimited = this.classifier.rateLimited?.() === true;
    return {
      batch,
      pool,
      stats: {
        scanned: candidates.length,
        unique: this.selection.distinctMoments(candidates),
        graded: accumulated.length,
        // Asked about but never came back — the gap between "109 photos" and a
        // pool with nothing in it. Reaching this line means the classifier
        // itself worked (a broken one throws), so the difference is photos
        // whose bytes were unreadable. A quota wall is a different story, told
        // by `quotaExhausted` in its own words: the photos it skipped were
        // never attempted, so counting them as unreadable would be a lie.
        // A throttled scan skipped photos it never attempted, for the same
        // reason a quota wall does — neither is an unreadable file.
        unreadable: quotaExhausted || rateLimited ? 0 : ungraded.length - freshlyGraded.length,
        quotaExhausted,
        rateLimited,
      },
    };
  }

  /**
   * Splits everything graded so far into the post itself and the ranked
   * remainder. The pool is every other graded photo, best first — with the
   * whole window graded this is what makes a swap a lookup instead of a wait.
   *
   * Both halves come from the same ranking. The pool used to be sorted by raw
   * `quality` while the batch was chosen by a category round-robin, so the two
   * could disagree about which of two photos was better — and a swap could hand
   * back something the rules rated *below* what it replaced.
   */
  private split(
    accumulated: PhotoClassification[],
    config: PublisherConfig,
    alreadySent: Set<string>,
  ): [PhotoClassification[], PhotoClassification[]] {
    const batch = this.selection.selectBatch(accumulated, config, alreadySent);
    const batchIds = new Set(batch.map(c => c.candidate.id));
    const pool = this.selection
      .rank(accumulated, config, alreadySent)
      .filter(c => !batchIds.has(c.candidate.id));
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
   * @param window The stretch to draw from, for the history backfill's per-post
   *              top-up. Omitted for live suggestions, which use the lookback.
   *              A backfilled post reconstructs one past window, so topping it
   *              up from "the last N days" would offer photos from a different
   *              trip entirely.
   */
  async pendingCandidates(
    config: PublisherConfig,
    known: ReadonlySet<string> = new Set(),
    window?: SuggestWindow,
  ): Promise<PhotoCandidate[]> {
    // The same window the scan used, so the "+" can never draw from a
    // different stretch than the post it is adding to.
    const queueWindow = window ?? (await this.liveWindow(config, Date.now()));
    const [candidates, alreadySent] = await Promise.all([
      this.mediaLibrary.photosBetween(queueWindow.start, queueWindow.end),
      this.sentTracker.sentCandidateIds(config.publisherId),
    ]);
    // Same ordering as the scan — distinct moments first, newest first within
    // each tier — so the "+" offers a fresh moment before it offers the third
    // frame of a burst. Crucially it *offers* that third frame eventually: the
    // old code ran the same discarding dedup here, which is what made a photo
    // dropped during the scan unreachable by any route the publisher had.
    return this.selection
      .gradingOrder(candidates)
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
    maxWaves = SuggestPhotosUseCase.TOP_UP_MAX_WAVES,
  ): Promise<ClassifyMoreResult> {
    const classified: PhotoClassification[] = [];
    const suggestions: PhotoClassification[] = [];
    let consumed = 0;
    let waves = 0;
    let quotaExhausted = false;
    let rateLimited = false;

    // Resolved once for the whole top-up, not per wave: it is the same face
    // throughout, and the lookup can be a network round trip.
    const reference = await this.faceReference(config);
    const referenceKey = SuggestPhotosUseCase.referenceKey(reference);
    const rules = SuggestPhotosUseCase.selectionConfig(config, reference);

    while (consumed < candidates.length && suggestions.length < want && waves < maxWaves) {
      waves++;
      const wave = candidates.slice(consumed, consumed + SuggestPhotosUseCase.TOP_UP_WAVE);
      // A wave the scan already graded (cap reached, or the photo arrived after
      // it) is answered from memory — no call, no quota.
      const remembered =
        (await this.grades?.load(wave.map(c => c.id), referenceKey)) ??
        new Map<string, PhotoClassification>();
      const fresh = wave.filter(c => !remembered.has(c.id));
      const graded =
        fresh.length > 0 ? await this.classifier.classify(fresh, undefined, undefined, reference) : [];
      if (graded.length > 0) await this.grades?.save(graded, referenceKey);
      const results = [
        ...wave.map(c => remembered.get(c.id)).filter((c): c is PhotoClassification => c != null),
        ...graded,
      ];
      consumed += wave.length;
      classified.push(...results);
      suggestions.push(...results.filter(c => isSuggestablePhoto(c, rules)));
      // A spent daily budget fails every remaining photo identically. Walking
      // the rest of the window would burn a wave per press and still come back
      // empty, so stop and let the caller say why (issue #81's lesson).
      if (this.classifier.quotaExhausted?.() === true) {
        quotaExhausted = true;
        break;
      }
      // Same reasoning, different wall: the provider is throttling and every
      // remaining photo in this round would be throttled too. Stop here, but
      // keep it distinguishable — this one clears in seconds.
      if (this.classifier.rateLimited?.() === true) {
        rateLimited = true;
        break;
      }
    }

    return {
      classified,
      suggestions,
      consumed,
      quotaExhausted,
      rateLimited,
      // Only a wave limit counts as "capped": a round that stopped because it
      // found what it wanted, because the queue ran dry, or because it hit a
      // wall, is not unfinished in the sense the "+" cares about.
      cappedEarly:
        suggestions.length < want &&
        !quotaExhausted &&
        !rateLimited &&
        consumed < candidates.length,
    };
  }
}
