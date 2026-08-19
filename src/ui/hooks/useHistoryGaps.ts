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
  frequency: Frequency = 'weekly',
): HistoryGapsState {
  return useMemo(() => {
    const raw = profile?.tripStartDate;
    const tripStartDate = raw != null ? parseLocalDate(raw) : null;
    if (tripStartDate == null) return { gaps: [], hasGaps: false, tripStartDate: null };
    if (!postingsComplete) return { gaps: [], hasGaps: false, tripStartDate };

    const { gaps } = findHistoryGaps({
      tripStartDate,
      endDate: new Date(),
      intervalDays: FREQUENCY_DAYS[frequency],
      postingDates: postings.map(p => new Date(p.createdAt)),
    });

    return { gaps, hasGaps: gaps.length > 0, tripStartDate };
  }, [profile?.tripStartDate, postings, postingsComplete, frequency]);
}
