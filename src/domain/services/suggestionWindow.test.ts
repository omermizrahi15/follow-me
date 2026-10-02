import { MAX_LOOKBACK_DAYS, windowStartMs } from './suggestionWindow';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);

/** Whole days between the returned start and `NOW`. */
function daysBack(start: number): number {
  return Math.round((NOW - start) / DAY);
}

describe('windowStartMs', () => {
  it('uses the configured lookback when the publisher has never posted', () => {
    expect(
      daysBack(windowStartMs({ now: NOW, lookbackDays: 7, newestPostedPhotoAt: null })),
    ).toBe(7);
  });

  it('reaches back to the last post when the publisher is overdue', () => {
    // Weekly cadence, last post nine days ago: the reminder went unanswered for
    // two days, and those two days hold the photos it was about.
    const start = windowStartMs({
      now: NOW,
      lookbackDays: 7,
      newestPostedPhotoAt: NOW - 9 * DAY,
    });
    expect(daysBack(start)).toBe(9);
  });

  it('starts at the last post even when it is more recent than the lookback', () => {
    // Posted an hour ago on a weekly cadence: the lookback only drives the
    // reminder schedule, so the window is "since the last post", not 7 days.
    const start = windowStartMs({
      now: NOW,
      lookbackDays: 7,
      newestPostedPhotoAt: NOW - 60 * 60 * 1000,
    });
    expect(NOW - start).toBe(60 * 60 * 1000);
  });

  it('starts at the last post when it is within the lookback', () => {
    const start = windowStartMs({
      now: NOW,
      lookbackDays: 7,
      newestPostedPhotoAt: NOW - 3 * DAY,
    });
    expect(daysBack(start)).toBe(3);
  });

  it('clamps a long absence so it cannot open an unbounded scan', () => {
    const start = windowStartMs({
      now: NOW,
      lookbackDays: 7,
      newestPostedPhotoAt: NOW - 365 * DAY,
    });
    expect(daysBack(start)).toBe(MAX_LOOKBACK_DAYS);
  });

  it('does not clamp a lookback that is legitimately long', () => {
    // Monthly cadence with no posts yet — 30 days is under the ceiling and must
    // survive intact.
    expect(
      daysBack(windowStartMs({ now: NOW, lookbackDays: 30, newestPostedPhotoAt: null })),
    ).toBe(30);
  });
});
