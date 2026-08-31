/**
 * What the suggested-post screen says about its own scan.
 *
 * These four sentences carry most of what the publisher can learn about why a
 * batch looks the way it does, and every one of them was once a lie worth
 * fixing: "nothing else worth posting in those days" for a spent AI budget,
 * "picked 10 from 109 scanned" when the AI had seen twelve. They are pure
 * string functions over numbers, so they belong here — beside the photo-sync
 * copy, and testable without a device.
 *
 * The parameter types are structural rather than imported: the numbers come
 * from an application-layer use case and a UI hook, and the domain may import
 * from neither.
 */

/**
 * Why a round of "look for another photo" produced nothing.
 *
 * Only `exhausted`, `quota` and `failed` mean stop asking. `capped` means the
 * round hit its own wave limit with the window still unfinished — reporting
 * that as "nothing left" is what greyed out the "+" on libraries with photos to
 * spare. `busy` is the provider throttling us, which clears on its own, and
 * `slow` is the request outliving its deadline — the publisher's connection,
 * which waiting alone does not mend.
 */
export type EmptyRoundReason = 'exhausted' | 'quota' | 'busy' | 'capped' | 'failed' | 'slow';

/** What a finished scan actually managed. Mirrors the use case's SuggestStats. */
export interface ScanStats {
  /** After burst dedup — the set worth grading. */
  unique: number;
  /** Grades in hand at the end. */
  graded: number;
  /** Photos the AI was asked about that produced nothing. */
  unreadable: number;
  /** The day's classification budget ran out during the scan. */
  quotaExhausted: boolean;
  /** The provider throttled us mid-scan — unlike the quota, this clears itself. */
  rateLimited: boolean;
  /** A request outlived its deadline — the connection, not the budget (issue #174). */
  timedOut: boolean;
}

/**
 * What to say when a round of looking produced nothing.
 *
 * Three genuinely different situations used to share one sentence — including
 * the case where the AI had only looked at twelve of a hundred photos. Stating
 * the reason is also what makes the right next move obvious: wait, try again,
 * or rescan.
 */
export function emptyRoundNote(reason: EmptyRoundReason | null, attempted: number): string | null {
  if (reason === 'quota') return "Today's AI limit is used up — try again tomorrow.";
  // Not tomorrow: the provider's per-minute ceiling clears on its own, and
  // telling publishers to come back the next day for a half-minute pause is
  // what made the feature look broken on the first attempt (issue #141).
  if (reason === 'busy') return 'The photo AI is busy right now — wait a moment and tap again.';
  // Not "busy" and not "down": the request was sent and never came back in
  // time. Naming the connection is the only version that suggests the move that
  // actually helps — try it somewhere with better signal (issue #174).
  if (reason === 'slow') {
    return 'The photo AI took too long to answer — check your connection and tap again.';
  }
  // Never phrased as a fact about the library: the round failed before it could
  // learn anything about it.
  if (reason === 'failed') return 'Could not reach the photo AI — nothing was analysed. Try again in a moment.';
  if (reason === 'capped') {
    return attempted > 0
      ? `Checked ${attempted} more photo${attempted === 1 ? '' : 's'} — nothing worth adding yet. Tap again to keep looking.`
      : 'Nothing yet — tap again to keep looking.';
  }
  if (reason === 'exhausted') return 'That’s every photo from those days — nothing left to swap in.';
  return null;
}

/**
 * The honest one-line account of a finished scan.
 *
 * "AI picked 10 photos from 109 scanned" was the old line, and it was the most
 * misleading thing on the screen: 109 is what the library handed over, while
 * the number that decides whether there is anything to swap in is how many
 * photos the AI actually got a look at. When a window barely grades — iCloud
 * originals that never arrive, a spent daily budget — that gap is the entire
 * explanation for "no more photos", and it used to be invisible.
 */
export function scanSummary(picked: number, stats: ScanStats | null, scanned: number): string {
  const photos = `${picked} photo${picked === 1 ? '' : 's'}`;
  if (stats == null) return `AI picked ${photos} from ${scanned} scanned.`;
  return `AI picked ${photos} — ${stats.graded} of ${stats.unique} analysed.`;
}

/** Why a scan analysed fewer photos than it found, when it did. */
export function scanShortfallNote(stats: ScanStats | null): string | null {
  if (stats == null) return null;
  if (stats.quotaExhausted) {
    return `Today’s AI limit ran out after ${stats.graded} photos — the rest of those days aren’t analysed yet.`;
  }
  if (stats.rateLimited) {
    return `The photo AI was busy after ${stats.graded} photos — rescan in a moment to finish the rest.`;
  }
  // Ranked under both walls: they are about the budget and the provider, which
  // a publisher can do nothing about, while this one points at something they
  // can — the connection the photos are travelling over.
  if (stats.timedOut) {
    return `The photo AI took too long after ${stats.graded} photos — rescan on a better connection to finish the rest.`;
  }
  if (stats.unreadable > 0) {
    return `${stats.unreadable} photo${stats.unreadable === 1 ? '' : 's'} couldn’t be read — usually iCloud originals that haven’t downloaded. Rescanning after they do will find them.`;
  }
  return null;
}
