/**
 * Pure window planning for the history backfill (issue #81). A publisher who
 * joins mid-trip tells us how often they'd have posted and when their travels
 * began; this splits that range into the posting slots we reconstruct, one
 * suggested post per window.
 *
 * Windows are built *backwards* from `endDate` so the newest one ends exactly
 * where the publisher's real posting history begins — the leftover remainder
 * lands on the oldest window, which is where a short stretch is least jarring.
 *
 * No clock, no I/O: `endDate` is always passed in, so the whole thing is
 * deterministic and exhaustively unit-testable.
 */

export interface HistoryWindow {
  /** Inclusive start of the window. */
  start: Date;
  /** Exclusive end of the window. */
  end: Date;
}

export interface HistoryWindowInput {
  startDate: Date;
  /** Usually "now" — the point the publisher's real posting history starts. */
  endDate: Date;
  /** Posting cadence in days. Matches FREQUENCY_DAYS, or a custom count. */
  intervalDays: number;
}

export interface HistoryWindowPlan {
  /** Newest-first, capped at `maxWindows`. */
  windows: HistoryWindow[];
  /** How many windows the range implies *before* the cap — shown to the user. */
  total: number;
  /** True when `windows` is only the newest slice of `total`. */
  truncated: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Ceiling on windows per backfill run. Each window costs up to
 * `photosPerPost * 2` Gemini classifications and the classify function allows
 * 500 per user per day (migration 20240015), so an uncapped multi-year range
 * would blow the daily quota partway through and 429 the rest of the scan.
 */
export const MAX_HISTORY_WINDOWS = 20;

export function planHistoryWindows(
  input: HistoryWindowInput,
  maxWindows: number = MAX_HISTORY_WINDOWS,
): HistoryWindowPlan {
  const { intervalDays } = input;
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
    throw new Error('planHistoryWindows intervalDays must be a positive integer');
  }
  if (!Number.isInteger(maxWindows) || maxWindows <= 0) {
    throw new Error('planHistoryWindows maxWindows must be a positive integer');
  }

  const startMs = input.startDate.getTime();
  const endMs = input.endDate.getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error('planHistoryWindows requires valid dates');
  }
  // A start on or after the end means there is no history to reconstruct —
  // an empty plan, not an error: the date pickers can legitimately land here.
  if (endMs <= startMs) return { windows: [], total: 0, truncated: false };

  const stepMs = intervalDays * MS_PER_DAY;
  // Counted arithmetically rather than by walking, so a decade-long range with
  // a 3-day cadence still costs O(maxWindows) instead of materialising 1200
  // windows just to throw all but 20 away.
  const total = Math.ceil((endMs - startMs) / stepMs);
  const count = Math.min(total, maxWindows);

  const windows: HistoryWindow[] = [];
  let cursor = endMs;
  for (let i = 0; i < count; i++) {
    // The oldest window is clamped to startDate, so it can be shorter than the
    // cadence — a partial window is still worth a post.
    const from = Math.max(startMs, cursor - stepMs);
    windows.push({ start: new Date(from), end: new Date(cursor) });
    cursor = from;
  }

  return { windows, total, truncated: total > count };
}
