/**
 * One ceiling the AI provider enforces, and how much of it is left.
 *
 * Mirrors the server's `ProviderLimits` (supabase/functions/classify-photos/
 * vision.ts) — the numbers the provider itself puts on every response. Unlike
 * everything else here they are per ACCOUNT, not per publisher, and they are
 * the only limits a scan can genuinely hit.
 */
export interface ProviderLimitWindow {
  readonly limit: number;
  readonly remaining: number;
  /**
   * Seconds until the window refills, or null when the provider didn't say.
   * Also the only clue to the period: providers never label a limit "per day"
   * or "per minute", so a ~60s reset is a minute bucket and a ~24h one is a
   * daily allowance.
   */
  readonly resetSeconds: number | null;
}

/** Everything the provider last said about what the account may still spend. */
export interface ProviderLimits {
  readonly provider: string;
  readonly model: string;
  readonly requests: ProviderLimitWindow | null;
  /** Tokens — the ceiling an image workload actually reaches first. */
  readonly tokens: ProviderLimitWindow | null;
  /** When the provider said it, epoch ms. A limit is only true for a moment. */
  readonly observedAt: number;
}

/**
 * How much of the day's AI budget a publisher has spent.
 *
 * The number counted is *photos sent to the classifier*, which is what
 * `classify_quota` (migration 20240015) increments per request.
 */
export interface AiUsageSnapshot {
  /** Photos graded (or attempted) for this publisher today. */
  readonly used: number;
  /**
   * Our own optional per-user ceiling, or null when we impose none.
   *
   * Null is the normal case now. This used to default to 500 photos a day — a
   * figure invented in the Edge Function's env defaults, matching nothing any
   * vendor enforces, and nevertheless the number the app showed publishers as
   * their "AI limit". The real wall is {@link provider}.
   */
  readonly limit: number | null;
  /** The server's date for the count, ISO `YYYY-MM-DD`, so the reset time is legible. */
  readonly day: string;
  /**
   * What the AI provider last said about the account's own ceilings, or null
   * when it has never been heard from (a fresh deployment, or a provider that
   * states nothing).
   */
  readonly provider?: ProviderLimits | null;
}

/** How close the budget is to running out — what the bar colours itself by. */
export type AiUsageLevel = 'ok' | 'low' | 'exhausted';

/**
 * A snapshot with everything a progress bar needs already worked out.
 *
 * Every derived number is nullable, because every one of them is a fraction of
 * a ceiling and there may not be a ceiling. Null means "there is no bar to
 * draw", which is a different thing from an empty bar or a full one — and
 * inventing a denominator to avoid the null is precisely the habit that put a
 * made-up 500 in front of publishers for months.
 */
export interface AiUsageSummary extends AiUsageSnapshot {
  /** Photos still available today, or null when nothing caps them. */
  readonly remaining: number | null;
  /** Spent share of the budget, clamped to 0..1 — the bar's fill width. */
  readonly usedFraction: number | null;
  /** The same number as a whole percent, for the label. */
  readonly usedPercent: number | null;
  readonly level: AiUsageLevel;
}
