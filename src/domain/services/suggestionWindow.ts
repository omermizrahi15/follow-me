/**
 * Where the app should start looking for photos to suggest.
 *
 * Two things need this answer and must not disagree: the on-device scan that
 * builds the suggested post, and the cloud sync that uploads the photos the
 * *server* builds it from. While only the scan knew about overdue publishers,
 * someone who missed their reminder saw the extra days on their phone and the
 * server's autonomous post silently did not — the same bug, half fixed, which
 * is harder to spot than not fixing it at all.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How far back either path will ever reach, however overdue the publisher is.
 *
 * Without a floor, someone who posted once and came back six months later would
 * open a six-month scan — thousands of photos, an iCloud fetch each. Two months
 * is longer than the widest posting cadence (monthly) and keeps the worst case
 * survivable.
 */
export const MAX_LOOKBACK_DAYS = 60;

export interface WindowInputs {
  /** Epoch millis for "now". Passed in so the rule stays pure and testable. */
  now: number;
  /** The publisher's configured lookback, in days. */
  lookbackDays: number;
  /**
   * When the newest photo they have already posted was taken, or null if they
   * have never posted.
   */
  newestPostedPhotoAt: number | null;
  maxLookbackDays?: number;
}

/**
 * Start of the window, as epoch millis.
 *
 * `min`, not `max`, is the whole point. The configured lookback is a *floor* —
 * a weekly publisher always sees at least their week, so photos from earlier in
 * the week that simply weren't chosen stay offerable — and the last post
 * extends it backwards when they are overdue.
 *
 * Anchoring to `now - lookbackDays` alone meant a missed reminder swallowed the
 * days in between: open the app two days late and the two oldest days had
 * rolled out of the window, taking exactly the photos the reminder was about.
 */
export function windowStartMs({
  now,
  lookbackDays,
  newestPostedPhotoAt,
  maxLookbackDays = MAX_LOOKBACK_DAYS,
}: WindowInputs): number {
  const configuredStart = now - lookbackDays * MS_PER_DAY;
  const wanted =
    newestPostedPhotoAt != null ? Math.min(configuredStart, newestPostedPhotoAt) : configuredStart;
  const floor = now - maxLookbackDays * MS_PER_DAY;
  return Math.max(wanted, floor);
}
