import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { GradingCoordinator } from '../services/GradingCoordinator';
import type { ScanOptions, SuggestProgress, SuggestResult, SuggestWindow } from './SuggestPhotosUseCase';

export type PreGradeOutcome =
  /** A live scan (or another background run) held the classifier — nothing started, or the run was cut short. */
  | 'busy'
  /** Ran to the end of its budget or the window. */
  | 'done'
  /** Stopped at a daily-quota or provider wall; back off before the next attempt. */
  | 'walled';

type Scanner = {
  execute(
    config: PublisherConfig,
    progress?: SuggestProgress,
    window?: SuggestWindow,
    options?: ScanOptions,
  ): Promise<SuggestResult>;
};

const SILENT: SuggestProgress = {
  onScanning() {},
  onScanned() {},
  onClassifying() {},
};

/**
 * Grades the publisher's recent photos before they ask, so opening the review
 * screen finds the window already graded and is a read rather than a wait.
 *
 * It is the ordinary scan with nothing watching: grades land in the same store
 * a live scan reads, so a pre-grade is never wasted work and never conflicts —
 * the next scan simply finds those photos already remembered, alongside every
 * not-yet-posted photo graded on earlier days.
 *
 * Two promises to the publisher: it spends at most `maxGrades` photos' worth of
 * the day's AI budget per run, and it gets out of the way of a live scan.
 */
export class PreGradePhotosUseCase {
  constructor(
    private readonly scanner: Scanner,
    private readonly coordinator: GradingCoordinator,
    private readonly maxGrades: number,
  ) {}

  async execute(config: PublisherConfig): Promise<PreGradeOutcome> {
    const slot = this.coordinator.tryBeginBackground();
    if (slot == null) return 'busy';
    try {
      const { stats } = await this.scanner.execute(config, SILENT, undefined, {
        shouldStop: () => slot.shouldStop(),
        maxGrades: this.maxGrades,
      });
      // A live scan took over mid-run: the work was cut off, not done.
      if (slot.shouldStop()) return 'busy';
      return stats.quotaExhausted || stats.rateLimited || stats.timedOut ? 'walled' : 'done';
    } finally {
      slot.end();
    }
  }
}
