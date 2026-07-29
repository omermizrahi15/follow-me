import { planHistoryWindows } from './historyWindows';
import type { HistoryWindow } from './historyWindows';

/**
 * Which stretches of a publisher's trip have no posting yet (issue #81).
 *
 * The naive check — "is there anything before the oldest post?" — only catches
 * a missing prefix. Real trips are patchier than that: someone posts for the
 * first fortnight, goes off-grid through the mountains, then picks up again.
 * That hole is exactly what the backfill exists to fill, so coverage is
 * evaluated window by window and any uncovered one counts as a gap, wherever
 * it sits in the trip.
 *
 * Pure: the clock, the postings and the cadence are all passed in.
 */

export interface HistoryGapInput {
  /** When the publisher says their travels began. */
  tripStartDate: Date;
  /** Where history stops — usually now. */
  endDate: Date;
  /** Posting cadence in days: a FREQUENCY_DAYS value or a custom count. */
  intervalDays: number;
  /** When each existing posting happened, in any order. */
  postingDates: Date[];
}

export interface HistoryGapPlan {
  /** Uncovered windows, newest first. */
  gaps: HistoryWindow[];
  /** Every window the trip spans, covered or not. */
  totalWindows: number;
  /** Windows that already hold at least one posting. */
  coveredWindows: number;
}

/**
 * Upper bound on windows examined for coverage. Five years at a three-day
 * cadence is ~610, so this leaves plenty of headroom while refusing to
 * materialise an unbounded list if a nonsense start date ever reaches here.
 */
const MAX_WINDOWS_EXAMINED = 2000;

const EMPTY: HistoryGapPlan = { gaps: [], totalWindows: 0, coveredWindows: 0 };

export function findHistoryGaps(input: HistoryGapInput): HistoryGapPlan {
  const { tripStartDate, endDate, intervalDays, postingDates } = input;
  if (endDate.getTime() <= tripStartDate.getTime()) return EMPTY;

  const plan = planHistoryWindows(
    { startDate: tripStartDate, endDate, intervalDays },
    MAX_WINDOWS_EXAMINED,
  );
  if (plan.windows.length === 0) return EMPTY;

  const stepMs = intervalDays * 24 * 60 * 60 * 1000;
  const endMs = endDate.getTime();
  const lastIndex = plan.windows.length - 1;
  const covered = new Set<number>();

  for (const posting of postingDates) {
    const t = posting.getTime();
    if (Number.isNaN(t) || t >= endMs || t < tripStartDate.getTime()) continue;

    // Windows are cut backwards from `endDate`, so a posting's window index
    // falls straight out of the elapsed time. The `- 1` keeps a posting landing
    // exactly on a boundary in the newer window, matching the half-open
    // [start, end) shape the scanner uses.
    const index = Math.min(Math.floor((endMs - t - 1) / stepMs), lastIndex);
    const window = plan.windows[index];
    // Re-check containment rather than trusting the arithmetic: the oldest
    // window is clamped to the trip start and so can be shorter than a full
    // interval, which the division alone doesn't know about.
    if (window != null && t >= window.start.getTime() && t < window.end.getTime()) {
      covered.add(index);
    }
  }

  const gaps = plan.windows.filter((_, i) => !covered.has(i));
  return { gaps, totalWindows: plan.windows.length, coveredWindows: covered.size };
}

/**
 * Whether anything is left to reconstruct — drives whether the History tab is
 * offered at all. A publisher whose trip is fully covered should never see it.
 */
export function hasHistoryGaps(input: HistoryGapInput): boolean {
  return findHistoryGaps(input).gaps.length > 0;
}
