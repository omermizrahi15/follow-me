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

  it('treats the lookback as a floor, never a ceiling', () => {
    // Posted an hour ago. Photos from earlier in the week that simply weren't
    // chosen must stay offerable, so the window does not collapse to an hour.
    const start = windowStartMs({
      now: NOW,
      lookbackDays: 7,
      newestPostedPhotoAt: NOW - 60 * 60 * 1000,
    });
    expect(daysBack(start)).toBe(7);
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
