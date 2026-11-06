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

  // The grid is anchored to the trip start and cut FORWARDS, so a window's
  // edges never move as days pass. Cut backwards from `endDate` (as the live
  // planner does), the whole grid slid every day: a stretch posted yesterday no
  // longer lined up with any window, the oldest window became a sliver of
  // already-posted days, and the rescan started at the beginning of the trip.
  // The short partial window, if there is one, sits at the newest end.
  const startMs = tripStartDate.getTime();
  const endMs = endDate.getTime();
  const stepMs = intervalDays * 24 * 60 * 60 * 1000;
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
    throw new Error('findHistoryGaps intervalDays must be a positive integer');
  }
  const total = Math.min(Math.ceil((endMs - startMs) / stepMs), MAX_WINDOWS_EXAMINED);
  const oldestFirst: HistoryWindow[] = [];
  for (let i = 0; i < total; i++) {
    oldestFirst.push({
      start: new Date(startMs + i * stepMs),
      end: new Date(Math.min(startMs + (i + 1) * stepMs, endMs)),
    });
  }
  const plan = { windows: [...oldestFirst].reverse() }; // newest first
  if (plan.windows.length === 0) return EMPTY;

  const lastIndex = plan.windows.length - 1;
  const covered = new Set<number>();

  for (const posting of postingDates) {
    const t = posting.getTime();
    if (Number.isNaN(t) || t >= endMs || t < startMs) continue;

    // Forward grid: the oldest-first index falls straight out of the elapsed
    // time, then flips to the newest-first order `plan.windows` is in. Half-open
    // [start, end), so a posting on a boundary belongs to the newer window.
    const forward = Math.min(Math.floor((t - startMs) / stepMs), lastIndex);
    const index = lastIndex - forward;
    const window = plan.windows[index];
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
