import type { AiUsageLevel, AiUsageSnapshot, AiUsageSummary } from '../entities/AiUsage';

/**
 * Spent share at which the day's AI budget stops being background information
 * and starts being a warning. Sized so a publisher on a staging device still
 * has room for a full scan (a window is well under a fifth of the default
 * ceiling) after the bar first turns amber.
 */
export const LOW_BUDGET_FRACTION = 0.8;

/**
 * Turns the raw daily count into everything a usage bar renders.
 *
 * Every awkward case here is one the server can genuinely produce. The count is
 * incremented *before* the request is judged, so a day that ended on a refusal
 * stores a number above the ceiling; and the ceiling itself is an env var that
 * can be set to zero to switch classification off. Both have to read as "the
 * budget is gone", never as a negative balance or a NaN-wide bar.
 */
export function summarizeAiUsage(snapshot: AiUsageSnapshot): AiUsageSummary {
  const used = Math.max(0, snapshot.used);
  const limit = Math.max(0, snapshot.limit);
  const remaining = Math.max(0, limit - used);
  // No budget at all is fully spent, not undefined: it is the state in which
  // nothing can be classified, which is what a full bar means.
  const usedFraction = limit === 0 ? 1 : Math.min(1, used / limit);

  return {
    used: snapshot.used,
    limit: snapshot.limit,
    day: snapshot.day,
    remaining,
    usedFraction,
    usedPercent: percent(usedFraction),
    level: level(usedFraction, remaining),
  };
}

/**
 * The fraction as a whole percent, with one deliberate exception: anything
 * spent at all shows as at least 1%. Rounding the first few photos of a
 * 500-photo day down to "0%" says the budget is untouched while the bar
 * already has ink in it.
 */
function percent(fraction: number): number {
  const rounded = Math.round(fraction * 100);
  return rounded === 0 && fraction > 0 ? 1 : rounded;
}

function level(usedFraction: number, remaining: number): AiUsageLevel {
  if (remaining === 0) return 'exhausted';
  return usedFraction >= LOW_BUDGET_FRACTION ? 'low' : 'ok';
}

/** What the usage bar puts next to itself. */
export interface AiUsageCopy {
  /** The one-glance number, beside the bar. */
  headline: string;
  /** The counts underneath, in the unit the budget is actually spent in. */
  detail: string;
}

/**
 * Words for a summary.
 *
 * "Photos", not requests or tokens: the ceiling counts photos sent to the
 * classifier, and a bar labelled in a unit the publisher never sees would be
 * unreadable. The raw `used` is shown even when it overshot — a day that ended
 * at 507 of 500 says something the clamped 500 does not.
 */
export function aiUsageCopy(summary: AiUsageSummary): AiUsageCopy {
  const left =
    summary.remaining === 0 ? 'resets tomorrow' : `${summary.remaining} left`;
  return {
    headline: `${summary.usedPercent}% used`,
    detail: `${summary.used} of ${summary.limit} photos today · ${left}`,
  };
}
