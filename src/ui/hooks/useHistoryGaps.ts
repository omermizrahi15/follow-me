import { useMemo } from 'react';
import { findHistoryGaps } from '../../domain/services/historyGaps';
import type { HistoryWindow } from '../../domain/services/historyWindows';
import { FREQUENCY_DAYS } from '../../domain/entities/PublisherConfig';
import type { Frequency } from '../../domain/entities/PublisherConfig';
import type { FeedPosting } from '../data/feed';
import type { ProfileDto } from '../../application/dtos';

interface HistoryGapsState {
  /** Stretches of the trip with no posting yet, newest first. */
  gaps: HistoryWindow[];
  /** Whether to offer the History tab at all. */
  hasGaps: boolean;
  /** The trip start the gaps were measured from, or null when it is unset. */
  tripStartDate: Date | null;
  /**
   * The same gap detection, run against a start date and cadence the publisher
   * has just chosen rather than the ones on their profile.
   *
   * The backfill screen asks for both and then had them ignored: whatever the
   * publisher picked, the run was handed the pre-computed `gaps`, which win
   * outright over the date range. Someone correcting a start date that was a
   * month out watched the scan rebuild the same stretches as before. Returns
   * null when gaps cannot be measured at all (no feed yet), which means "scan
   * the whole range" rather than "scan nothing".
   */
  gapsFor: (startDate: Date, intervalDays: number) => HistoryWindow[] | null;
}

/** "2026-06-14" -> local midnight, matching how the date was stored. */
function parseLocalDate(value: string): Date | null {
  const [y, m, d] = value.split('-').map(Number);
  if (y == null || m == null || d == null) return null;
  const parsed = new Date(y, m - 1, d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Whether the publisher still has travels to reconstruct, and which stretches
 * (issue #81). Drives the History tab: it appears only when something really
 * is missing, so a publisher who has posted all along never sees it.
 *
 * With no trip start date the answer is "unknown", not "complete" — the tab
 * stays hidden and the publisher is asked for the date in their profile first.
 * Guessing from the oldest post would be wrong in the one case that matters:
 * someone who started posting late has an oldest post that says nothing about
 * when they actually set off.
 *
 * `postingsComplete` says whether `postings` is the whole feed or just the
 * pages loaded so far (issue #116). A partial feed answers the same "unknown":
 * every stretch older than the last page loaded would look empty, and offering
 * to reconstruct a trip that was posted all along would duplicate it.
 */
export function useHistoryGaps(
  profile: ProfileDto | null,
  postings: FeedPosting[],
  postingsComplete: boolean,
  /**
   * The publisher's real cadence. Null means it has not loaded yet — the tab
   * stays hidden rather than falling back to weekly, which is what carved a
   * three-day publisher's trip into seven-day windows and declared six days in
   * seven already covered.
   */
  frequency: Frequency | null,
): HistoryGapsState {
  return useMemo(() => {
    const raw = profile?.tripStartDate;
    const tripStartDate = raw != null ? parseLocalDate(raw) : null;
    const postingDates = postings.map(p => new Date(p.createdAt));
    const measurable = tripStartDate != null && postingsComplete && frequency != null;

    const gapsFor = (startDate: Date, intervalDays: number): HistoryWindow[] | null =>
      postingsComplete
        ? findHistoryGaps({
            tripStartDate: startDate,
            endDate: new Date(),
            intervalDays,
            postingDates,
          }).gaps
        : null;

    if (!measurable) {
      return { gaps: [], hasGaps: false, tripStartDate, gapsFor };
    }

    const { gaps } = findHistoryGaps({
      tripStartDate,
      endDate: new Date(),
      intervalDays: FREQUENCY_DAYS[frequency],
      postingDates,
    });

    return { gaps, hasGaps: gaps.length > 0, tripStartDate, gapsFor };
  }, [profile?.tripStartDate, postings, postingsComplete, frequency]);
}
