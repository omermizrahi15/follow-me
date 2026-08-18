import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IPhotoClassifier } from '../../domain/interfaces';
import { planHistoryWindows, MAX_HISTORY_WINDOWS } from '../../domain/services/historyWindows';

/**
 * Hard ceiling on windows walked in one run, so a nonsense start date can't
 * spin forever. Well above any real trip: five years at a three-day cadence is
 * about 610.
 */
const MAX_WINDOWS_WALKED = 2000;
import type { HistoryWindow, HistoryWindowPlan } from '../../domain/services/historyWindows';
import type { SuggestPhotosUseCase } from './SuggestPhotosUseCase';

export interface BackfillHistoryInput {
  config: PublisherConfig;
  /** When the publisher's travels began — the far edge of the reconstruction. */
  startDate: Date;
  /** Where history stops and the real posting record begins. Defaults to now. */
  endDate?: Date;
  /** Posting cadence in days: a FREQUENCY_DAYS value or a custom "other" count. */
  intervalDays: number;
  /**
   * How many reconstructed POSTS to stop at. Counting posts rather than
   * windows is deliberate: an empty window costs a library query and no AI at
   * all, so capping scanned windows would spend the whole allowance walking
   * quiet months and never reach the ones with photos in them.
   */
  maxWindows?: number;
  /**
   * Scan exactly these windows instead of every one since `startDate`. The UI
   * passes the gaps it found, so a partly-posted trip doesn't spend the day's
   * AI budget re-suggesting stretches that already have a posting (issue #81).
   */
  windows?: HistoryWindow[];
  /**
   * Awaited before each window starts. The UI resolves it immediately when
   * running and holds it while paused, so a pause takes effect at a window
   * boundary — never mid-classification, which would waste the AI calls
   * already in flight and the quota they cost.
   */
  beforeWindow?: () => Promise<void>;
}

/** What the library scan turned up for one window, before any AI ran. */
export interface WindowScan {
  /** Photos found in the window. */
  found: number;
  /** What was left after burst/near-duplicate shots were collapsed. */
  unique: number;
}

/** One reconstructed posting, before the publisher reviews and publishes it. */
export interface BackfillDraft {
  window: HistoryWindow;
  /** The scan behind this stretch, so a thin post can explain itself. */
  scanned: WindowScan;
  /** AI-selected photos for this window, same rules as a live post. */
  batch: PhotoClassification[];
  /** Classified-but-unselected photos, available as swaps in review. */
  pool: PhotoClassification[];
}

export interface BackfillProgress {
  /** Fires once, before any scanning, so the UI can show the window count. */
  onPlanned?(plan: HistoryWindowPlan): void;
  /** Fires as each window starts. `index` is 1-based. */
  onWindowStart?(index: number, total: number, window: HistoryWindow): void;
  /** Fires once the window's library scan is done, before any AI runs. */
  onWindowScanned?(index: number, total: number, scan: WindowScan): void;
  /**
   * Fires repeatedly *within* a window as its photos are classified. Without
   * it a stretch is a black box: a slow one looks identical to a hung one, and
   * on a poor connection a single window can take minutes.
   */
  onWindowProgress?(
    index: number,
    total: number,
    progress: { classified: number; of: number; batch: PhotoClassification[] },
  ): void;
  /** Fires when a window finishes; `draft` is null when it held no photos. */
  onWindowDone?(index: number, total: number, draft: BackfillDraft | null): void;
}

export interface BackfillHistoryResult {
  /** Windows that produced photos, newest first. Empty windows are dropped. */
  drafts: BackfillDraft[];
  plan: HistoryWindowPlan;
  /** How many windows actually ran (< plan.windows.length if the quota ran out). */
  scannedWindows: number;
  /** True when the day's classification budget stopped the run early. */
  quotaExhausted: boolean;
  /**
   * True when AI throttling stopped the run early. Kept apart from
   * `quotaExhausted` because resuming is a matter of seconds, not of waiting
   * for tomorrow (issue #141).
   */
  rateLimited: boolean;
}

/**
 * Reconstructs a publisher's pre-app travel history (issue #81): split the
 * range into cadence-sized windows and run the *normal* suggestion pipeline on
 * each, so a backfilled post is indistinguishable in quality from an organic
 * one. Produces drafts only — nothing is published until the publisher reviews
 * them, and nothing here ever messages a subscriber.
 *
 * Windows run sequentially, not in parallel: each one already fans out four
 * concurrent Gemini calls internally, and scanning windows concurrently would
 * multiply both the phone's memory pressure (full-res decodes) and the rate at
 * which the daily quota burns down.
 */
export class BackfillHistoryUseCase {
  constructor(
    private readonly suggestPhotos: Pick<SuggestPhotosUseCase, 'execute'>,
    private readonly classifier: Pick<IPhotoClassifier, 'quotaExhausted' | 'rateLimited'>,
  ) {}

  /**
   * The windows to scan, without scanning — powers the setup preview.
   *
   * OLDEST FIRST, unlike the newest-first planner it is built from: a history
   * is rebuilt forwards from where the trip began, so the first stretch the
   * publisher sees is the start of their travels and the last is nearest today.
   * Capping therefore keeps the earliest windows and a second run picks up
   * where this one stopped.
   */
  plan(input: BackfillHistoryInput): HistoryWindowPlan {
    // Explicit windows (the gaps the UI found) are already the answer.
    const all = input.windows ?? planHistoryWindows(
      {
        startDate: input.startDate,
        endDate: input.endDate ?? new Date(),
        intervalDays: input.intervalDays,
      },
      MAX_WINDOWS_WALKED,
    ).windows;

    // Every window is walked; the run stops on POSTS produced, in execute().
    const chronological = [...all].sort((a, b) => a.start.getTime() - b.start.getTime());
    return {
      windows: chronological,
      total: chronological.length,
      truncated: false,
    };
  }

  async execute(
    input: BackfillHistoryInput,
    progress?: BackfillProgress,
  ): Promise<BackfillHistoryResult> {
    const plan = this.plan(input);
    progress?.onPlanned?.(plan);

    const drafts: BackfillDraft[] = [];
    const total = plan.windows.length;
    const maxPosts = input.maxWindows ?? MAX_HISTORY_WINDOWS;
    let scannedWindows = 0;
    let quotaExhausted = false;
    let rateLimited = false;

    for (const [i, window] of plan.windows.entries()) {
      await input.beforeWindow?.();
      progress?.onWindowStart?.(i + 1, total, window);

      // Captured from the scan callback so the finished draft can carry it —
      // a stretch that came back with three photos should be able to say
      // whether that is all there was, or all that survived deduplication.
      let scanned: WindowScan = { found: 0, unique: 0 };

      const { batch, pool } = await this.suggestPhotos.execute(
        input.config,
        {
          onScanning: () => undefined,
          onScanned: (found, unique) => {
            scanned = { found, unique };
            progress?.onWindowScanned?.(i + 1, total, scanned);
          },
          onClassifying: (classified, of, currentBatch) =>
            progress?.onWindowProgress?.(i + 1, total, { classified, of, batch: currentBatch }),
        },
        window,
      );
      scannedWindows++;

      // A window with nothing in it is normal — weeks at home between trips.
      // Dropping it keeps the review timeline about places the publisher went.
      const draft = batch.length > 0 ? { window, scanned, batch, pool } : null;
      if (draft != null) drafts.push(draft);
      progress?.onWindowDone?.(i + 1, total, draft);

      // Enough reconstructed for one sitting. Quiet windows walked along the
      // way cost nothing and do not count towards it.
      if (drafts.length >= maxPosts) break;

      // Stop the moment the day's budget is gone. Everything reconstructed so
      // far is kept and returned — the publisher can review and publish it now
      // and resume the rest tomorrow, rather than losing the whole run.
      if (this.classifier.quotaExhausted?.() === true) {
        quotaExhausted = true;
        break;
      }

      // Same stop, different wall. Grinding the remaining windows against a
      // throttled provider would produce empty posts and spend the budget the
      // next window needs, so bank what is reconstructed and let the publisher
      // resume shortly.
      if (this.classifier.rateLimited?.() === true) {
        rateLimited = true;
        break;
      }
    }

    return { drafts, plan, scannedWindows, quotaExhausted, rateLimited };
  }
}
