/**
 * How much of the day's AI budget a publisher has spent.
 *
 * The number counted is *photos sent to the classifier*, which is what
 * `classify_quota` (migration 20240015) increments per request and what the
 * classify-photos function refuses on once the day's total passes its ceiling.
 * It is our own per-user ceiling, not the model vendor's account-wide one —
 * that lives on the provider's dashboard and nothing in the app can see it.
 */
export interface AiUsageSnapshot {
  /** Photos graded (or attempted) for this publisher today. */
  readonly used: number;
  /** The day's ceiling — the server's CLASSIFY_DAILY_QUOTA, not a client guess. */
  readonly limit: number;
  /** The server's date for the count, ISO `YYYY-MM-DD`, so the reset time is legible. */
  readonly day: string;
}

/** How close the budget is to running out — what the bar colours itself by. */
export type AiUsageLevel = 'ok' | 'low' | 'exhausted';

/** A snapshot with everything a progress bar needs already worked out. */
export interface AiUsageSummary extends AiUsageSnapshot {
  /** Photos still available today. Never negative, even when `used` overshot. */
  readonly remaining: number;
  /** Spent share of the budget, clamped to 0..1 — the bar's fill width. */
  readonly usedFraction: number;
  /** The same number as a whole percent, for the label. */
  readonly usedPercent: number;
  readonly level: AiUsageLevel;
}
