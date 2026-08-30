import type {
  AiUsageLevel,
  AiUsageSnapshot,
  AiUsageSummary,
  ProviderLimits,
} from '../entities/AiUsage';

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

  // No ceiling of ours: there is a count but no fraction of anything, so every
  // derived number is null rather than computed against a stand-in. Producing
  // one here is exactly how an invented 500 came to be shown as fact.
  if (snapshot.limit == null) {
    return {
      used: snapshot.used,
      limit: null,
      day: snapshot.day,
      provider: snapshot.provider ?? null,
      remaining: null,
      usedFraction: null,
      usedPercent: null,
      // Our ceiling cannot be the thing running out when we have set none. The
      // provider's limits are reported in their own right — see providerLimitCopy.
      level: 'ok',
    };
  }

  const limit = Math.max(0, snapshot.limit);
  const remaining = Math.max(0, limit - used);
  // A ceiling set to zero is the deliberate kill switch, and fully spent: it is
  // the state in which nothing can be classified, which is what a full bar means.
  const usedFraction = limit === 0 ? 1 : Math.min(1, used / limit);

  return {
    used: snapshot.used,
    limit: snapshot.limit,
    day: snapshot.day,
    provider: snapshot.provider ?? null,
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
  // Nothing of ours caps it, so there is no percentage to state — only what was
  // actually spent. A "0% used" against a limit we invented was worse than
  // silence: it answered a question about the AI's real budget with a number
  // that had nothing to do with it.
  if (summary.limit == null || summary.usedPercent == null) {
    return {
      headline: `${summary.used} photos`,
      detail: 'graded today · no limit of ours',
    };
  }

  const left = summary.remaining === 0 ? 'resets tomorrow' : `${summary.remaining} left`;
  return {
    headline: `${summary.usedPercent}% used`,
    detail: `${summary.used} of ${summary.limit} photos today · ${left}`,
  };
}

/**
 * Roughly what one photo costs the provider in tokens.
 *
 * Measured, not assumed: the classify function logs `total_tokens` against the
 * image count on every Groq call, and a downscaled 768px image comes in around
 * a thousand. Deliberately approximate — it exists to turn "2450 tokens left",
 * which means nothing to anyone, into "about two more photos", which is the
 * unit the rest of the app is spent in.
 */
export const TOKENS_PER_PHOTO = 1_000;

/** What the provider's own ceilings look like, written out. */
export interface ProviderLimitCopy {
  /** Who is answering, and as what model. */
  headline: string;
  /** One line per ceiling, plus the photo estimate when tokens are reported. */
  lines: string[];
}

/** A reset delay in the largest unit that stays readable. */
function resetIn(seconds: number | null): string {
  if (seconds == null) return '';
  if (seconds < 60) return ` · resets in ${seconds}s`;
  if (seconds < 3600) return ` · resets in ${Math.round(seconds / 60)}m`;
  return ` · resets in ${Math.round(seconds / 3600)}h`;
}

/**
 * The provider's ceilings in words — the real ones.
 *
 * Null in, null out: a provider that has never answered has said nothing, and
 * nothing is what gets shown. The alternative — a zeroed row — reads as a wall
 * that does not exist.
 */
export function providerLimitCopy(limits: ProviderLimits | null): ProviderLimitCopy | null {
  if (limits == null) return null;

  const lines: string[] = [];
  if (limits.requests != null) {
    const { remaining, limit, resetSeconds } = limits.requests;
    lines.push(`Requests: ${remaining} of ${limit} left${resetIn(resetSeconds)}`);
  }
  if (limits.tokens != null) {
    const { remaining, limit, resetSeconds } = limits.tokens;
    lines.push(`Tokens: ${remaining} of ${limit} left${resetIn(resetSeconds)}`);
    // The line that makes the rest of it legible. Tokens are the ceiling this
    // workload actually hits, and nobody can convert them to photos in their
    // head while wondering why a scan stopped at 40.
    lines.push(
      `≈ ${Math.floor(remaining / TOKENS_PER_PHOTO)} more photos before the token window refills`,
    );
  }

  return { headline: `${limits.provider} · ${limits.model}`, lines };
}
