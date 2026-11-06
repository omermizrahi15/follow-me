import { findHistoryGaps, hasHistoryGaps } from './historyGaps';
import type { HistoryGapInput } from './historyGaps';

const TRIP_START = new Date('2026-06-01T00:00:00Z');
const NOW = new Date('2026-06-22T00:00:00Z'); // three weekly windows

/** Weekly windows over the fixture range, newest first:
 *  w0 = 15–22 Jun, w1 = 8–15 Jun, w2 = 1–8 Jun. */
const base: Omit<HistoryGapInput, 'postingDates'> = {
  tripStartDate: TRIP_START,
  endDate: NOW,
  intervalDays: 7,
};

const at = (iso: string): Date => new Date(iso);
const gapStarts = (input: HistoryGapInput): string[] =>
  findHistoryGaps(input).gaps.map(g => g.start.toISOString());

describe('findHistoryGaps — nothing posted yet', () => {
  it('reports every window as a gap', () => {
    const plan = findHistoryGaps({ ...base, postingDates: [] });

    expect(plan.totalWindows).toBe(3);
    expect(plan.coveredWindows).toBe(0);
    expect(plan.gaps).toHaveLength(3);
  });
});

describe('findHistoryGaps — fully covered', () => {
  it('reports no gaps when every window holds a posting', () => {
    const plan = findHistoryGaps({
      ...base,
      postingDates: [at('2026-06-18T10:00:00Z'), at('2026-06-11T10:00:00Z'), at('2026-06-04T10:00:00Z')],
    });

    expect(plan.gaps).toEqual([]);
    expect(plan.coveredWindows).toBe(3);
  });

  it('counts a window once even with several postings in it', () => {
    const plan = findHistoryGaps({
      ...base,
      postingDates: [
        at('2026-06-16T10:00:00Z'), at('2026-06-17T10:00:00Z'), at('2026-06-18T10:00:00Z'),
      ],
    });

    expect(plan.coveredWindows).toBe(1);
    expect(plan.gaps).toHaveLength(2);
  });
});

describe('findHistoryGaps — a hole in the middle of a trip', () => {
  // THE case that a "is anything older than my oldest post?" check misses:
  // the publisher posted at both ends and went quiet in between.
  it('finds a gap between two covered windows', () => {
    const plan = findHistoryGaps({
      ...base,
      postingDates: [at('2026-06-18T10:00:00Z'), at('2026-06-04T10:00:00Z')],
    });

    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0]?.start.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    expect(plan.gaps[0]?.end.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('finds several holes across a longer trip', () => {
    // Ten weekly windows; post only in the newest and the oldest.
    const input: HistoryGapInput = {
      tripStartDate: at('2026-04-13T00:00:00Z'),
      endDate: NOW,
      intervalDays: 7,
      postingDates: [at('2026-06-20T10:00:00Z'), at('2026-04-15T10:00:00Z')],
    };

    const plan = findHistoryGaps(input);
    expect(plan.totalWindows).toBe(10);
    expect(plan.coveredWindows).toBe(2);
    expect(plan.gaps).toHaveLength(8);
  });

  it('still reports gaps when only the most recent stretch is covered', () => {
    const plan = findHistoryGaps({ ...base, postingDates: [at('2026-06-20T10:00:00Z')] });
    expect(gapStarts({ ...base, postingDates: [at('2026-06-20T10:00:00Z')] })).toEqual([
      '2026-06-08T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ]);
    expect(plan.coveredWindows).toBe(1);
  });
});

describe('findHistoryGaps — window boundaries', () => {
  it('assigns a posting on a boundary to the newer window', () => {
    // 15 Jun 00:00 is w1's end and w0's start; half-open [start, end) puts it in w0.
    const plan = findHistoryGaps({ ...base, postingDates: [at('2026-06-15T00:00:00Z')] });

    expect(gapStarts({ ...base, postingDates: [at('2026-06-15T00:00:00Z')] })).toEqual([
      '2026-06-08T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ]);
    expect(plan.coveredWindows).toBe(1);
  });

  it('covers the oldest window from a posting on the trip start itself', () => {
    const plan = findHistoryGaps({ ...base, postingDates: [TRIP_START] });

    expect(plan.coveredWindows).toBe(1);
    expect(gapStarts({ ...base, postingDates: [TRIP_START] })).toEqual([
      '2026-06-15T00:00:00.000Z',
      '2026-06-08T00:00:00.000Z',
    ]);
  });

  it('covers a short clamped newest window', () => {
    // 17 days at a weekly cadence: the newest window is only 3 days long.
    const input: HistoryGapInput = {
      tripStartDate: at('2026-06-01T00:00:00Z'),
      endDate: at('2026-06-18T00:00:00Z'),
      intervalDays: 7,
      postingDates: [at('2026-06-16T10:00:00Z')],
    };

    const plan = findHistoryGaps(input);
    expect(plan.totalWindows).toBe(3);
    expect(plan.coveredWindows).toBe(1);
    expect(plan.gaps.every(g => g.end.getTime() <= at('2026-06-15T00:00:00Z').getTime())).toBe(true);
  });
});

describe('findHistoryGaps — a grid that does not move with the clock', () => {
  // The bug: windows were cut backwards from "now", so every day the whole grid
  // slid and a stretch posted yesterday no longer lined up with any window. The
  // oldest window became a sliver of already-posted days, and the rescan began
  // at the very start of the trip instead of after the first post.
  it('keeps a posted first stretch covered, and starts the next gap after it, as days pass', () => {
    const postedOn = at('2026-06-07T10:00:00Z'); // end of the first week
    for (const today of ['2026-06-22T00:00:00Z', '2026-06-23T12:00:00Z', '2026-06-26T00:00:00Z']) {
      const { gaps } = findHistoryGaps({
        ...base, endDate: at(today), postingDates: [postedOn],
      });
      const oldest = gaps[gaps.length - 1];
      expect(oldest?.start.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    }
  });

  it('puts the short partial window at the newest end', () => {
    const { gaps } = findHistoryGaps({ ...base, endDate: at('2026-06-25T00:00:00Z'), postingDates: [] });
    expect(gaps[0]?.start.toISOString()).toBe('2026-06-22T00:00:00.000Z');
    expect(gaps[0]?.end.toISOString()).toBe('2026-06-25T00:00:00.000Z');
  });
});

describe('findHistoryGaps — postings outside the trip', () => {
  it('ignores postings from before the trip started', () => {
    const plan = findHistoryGaps({ ...base, postingDates: [at('2026-05-20T10:00:00Z')] });
    expect(plan.coveredWindows).toBe(0);
    expect(plan.gaps).toHaveLength(3);
  });

  it('ignores postings dated at or after the end of the range', () => {
    const plan = findHistoryGaps({
      ...base,
      postingDates: [NOW, at('2026-07-01T10:00:00Z')],
    });
    expect(plan.coveredWindows).toBe(0);
  });

  it('ignores invalid dates rather than throwing', () => {
    const plan = findHistoryGaps({
      ...base,
      postingDates: [new Date('nonsense'), at('2026-06-18T10:00:00Z')],
    });
    expect(plan.coveredWindows).toBe(1);
  });
});

describe('findHistoryGaps — degenerate ranges', () => {
  it('is empty when the trip has not started yet', () => {
    expect(findHistoryGaps({
      tripStartDate: at('2026-07-01T00:00:00Z'),
      endDate: NOW,
      intervalDays: 7,
      postingDates: [],
    })).toEqual({ gaps: [], totalWindows: 0, coveredWindows: 0 });
  });

  it('is empty when the trip starts exactly now', () => {
    expect(findHistoryGaps({ ...base, tripStartDate: NOW, postingDates: [] }).gaps).toEqual([]);
  });
});

describe('findHistoryGaps — cadence', () => {
  it('honours a custom interval', () => {
    // 21 days at a 3-day cadence = 7 windows.
    const plan = findHistoryGaps({ ...base, intervalDays: 3, postingDates: [] });
    expect(plan.totalWindows).toBe(7);
  });

  it('a single posting covers less of a short cadence than a long one', () => {
    const posting = [at('2026-06-20T10:00:00Z')];
    const weekly = findHistoryGaps({ ...base, intervalDays: 7, postingDates: posting });
    const monthly = findHistoryGaps({ ...base, intervalDays: 30, postingDates: posting });

    expect(weekly.gaps).toHaveLength(2);
    // One 30-day window spans the whole trip, and it holds the posting.
    expect(monthly.gaps).toHaveLength(0);
  });
});

describe('hasHistoryGaps', () => {
  it('is false for a fully covered trip — the History tab stays hidden', () => {
    expect(hasHistoryGaps({
      ...base,
      postingDates: [at('2026-06-18T10:00:00Z'), at('2026-06-11T10:00:00Z'), at('2026-06-04T10:00:00Z')],
    })).toBe(false);
  });

  it('is true when a stretch in the middle is missing', () => {
    expect(hasHistoryGaps({
      ...base,
      postingDates: [at('2026-06-18T10:00:00Z'), at('2026-06-04T10:00:00Z')],
    })).toBe(true);
  });

  it('is true when nothing has been posted at all', () => {
    expect(hasHistoryGaps({ ...base, postingDates: [] })).toBe(true);
  });
});
