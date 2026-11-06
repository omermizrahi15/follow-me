import { groupSkippedWindows, skippedReasonCopy } from './skippedWindows';
import type { SkipReason, SkippedWindowLike } from './skippedWindows';

const d = (s: string): Date => new Date(`${s}T00:00:00Z`);
const w = (a: string, b: string, reason: SkipReason, found = 0): SkippedWindowLike =>
  ({ window: { start: d(a), end: d(b) }, reason, found });

describe('groupSkippedWindows', () => {
  it('merges neighbouring windows with the same reason into one stretch', () => {
    const groups = groupSkippedWindows([
      w('2026-01-04', '2026-01-07', 'no_photos'),
      w('2026-01-07', '2026-01-10', 'no_photos'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ reason: 'no_photos', windows: 2, found: 0 });
    expect(groups[0]!.start).toEqual(d('2026-01-04'));
    expect(groups[0]!.end).toEqual(d('2026-01-10'));
  });

  it('keeps a different reason as its own stretch and sums the photos found', () => {
    const groups = groupSkippedWindows([
      w('2026-01-04', '2026-01-07', 'none_kept', 5),
      w('2026-01-07', '2026-01-10', 'none_kept', 7),
      w('2026-01-10', '2026-01-13', 'no_photos'),
    ]);
    expect(groups.map(g => g.reason)).toEqual(['none_kept', 'no_photos']);
    expect(groups[0]!.found).toBe(12);
  });

  it('sorts oldest first whatever order it is given', () => {
    const groups = groupSkippedWindows([
      w('2026-02-01', '2026-02-04', 'no_photos'),
      w('2026-01-01', '2026-01-04', 'none_kept', 3),
    ]);
    expect(groups[0]!.start).toEqual(d('2026-01-01'));
  });

  it('returns nothing for nothing', () => {
    expect(groupSkippedWindows([])).toEqual([]);
  });
});

describe('skippedReasonCopy', () => {
  it('explains each reason in the publisher’s terms', () => {
    expect(skippedReasonCopy('no_photos')).toMatch(/no photos/i);
    expect(skippedReasonCopy('unreadable')).toMatch(/iCloud|couldn.t be read/i);
    expect(skippedReasonCopy('none_kept')).toMatch(/already posted|quality|categor/i);
  });
});
