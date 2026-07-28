import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import type { IPhotoClassifier } from '../../domain/interfaces';
import { planHistoryWindows, MAX_HISTORY_WINDOWS } from '../../domain/services/historyWindows';
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
  /** Overrides the window cap — tests and the preview UI pass their own. */
  maxWindows?: number;
}

/** One reconstructed posting, before the publisher reviews and publishes it. */
export interface BackfillDraft {
  window: HistoryWindow;
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
    private readonly classifier: Pick<IPhotoClassifier, 'quotaExhausted'>,
  ) {}

  /** The window plan for a range, without scanning — powers the setup preview. */
  plan(input: BackfillHistoryInput): HistoryWindowPlan {
    return planHistoryWindows(
      {
        startDate: input.startDate,
        endDate: input.endDate ?? new Date(),
        intervalDays: input.intervalDays,
      },
      input.maxWindows ?? MAX_HISTORY_WINDOWS,
    );
  }

  async execute(
    input: BackfillHistoryInput,
    progress?: BackfillProgress,
  ): Promise<BackfillHistoryResult> {
    const plan = this.plan(input);
    progress?.onPlanned?.(plan);

    const drafts: BackfillDraft[] = [];
    const total = plan.windows.length;
    let scannedWindows = 0;
    let quotaExhausted = false;

    for (const [i, window] of plan.windows.entries()) {
      progress?.onWindowStart?.(i + 1, total, window);

      const { batch, pool } = await this.suggestPhotos.execute(input.config, undefined, window);
      scannedWindows++;

      // A window with nothing in it is normal — weeks at home between trips.
      // Dropping it keeps the review timeline about places the publisher went.
      const draft = batch.length > 0 ? { window, batch, pool } : null;
      if (draft != null) drafts.push(draft);
      progress?.onWindowDone?.(i + 1, total, draft);

      // Stop the moment the day's budget is gone. Everything reconstructed so
      // far is kept and returned — the publisher can review and publish it now
      // and resume the rest tomorrow, rather than losing the whole run.
      if (this.classifier.quotaExhausted?.() === true) {
        quotaExhausted = true;
        break;
      }
    }

    return { drafts, plan, scannedWindows, quotaExhausted };
  }
}
