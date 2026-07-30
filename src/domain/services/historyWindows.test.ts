import { planHistoryWindows, MAX_HISTORY_WINDOWS } from './historyWindows';
import type { HistoryWindow } from './historyWindows';

const iso = (w: HistoryWindow): [string, string] => [w.start.toISOString(), w.end.toISOString()];

describe('planHistoryWindows', () => {
  it('splits an exact multiple of the interval into equal windows, newest first', () => {
    const plan = planHistoryWindows({
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-22T00:00:00Z'), // 21 days = 3 weekly windows
      intervalDays: 7,
    });

    expect(plan.total).toBe(3);
    expect(plan.truncated).toBe(false);
    expect(plan.windows.map(iso)).toEqual([
      ['2026-06-15T00:00:00.000Z', '2026-06-22T00:00:00.000Z'],
      ['2026-06-08T00:00:00.000Z', '2026-06-15T00:00:00.000Z'],
      ['2026-06-01T00:00:00.000Z', '2026-06-08T00:00:00.000Z'],
    ]);
  });

  it('clamps the remainder onto the oldest window, keeping the newest aligned to endDate', () => {
    const plan = planHistoryWindows({
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-18T00:00:00Z'), // 17 days = 2 full weeks + 3 days
      intervalDays: 7,
    });

    expect(plan.total).toBe(3);
    expect(plan.windows.map(iso)).toEqual([
      ['2026-06-11T00:00:00.000Z', '2026-06-18T00:00:00.000Z'],
      ['2026-06-04T00:00:00.000Z', '2026-06-11T00:00:00.000Z'],
      // Short window — 3 days of history is still worth a post.
      ['2026-06-01T00:00:00.000Z', '2026-06-04T00:00:00.000Z'],
    ]);
  });

  it('supports a custom ("other") interval', () => {
    const plan = planHistoryWindows({
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-11T00:00:00Z'), // 10 days
      intervalDays: 5,
    });

    expect(plan.total).toBe(2);
    expect(plan.windows.map(iso)).toEqual([
      ['2026-06-06T00:00:00.000Z', '2026-06-11T00:00:00.000Z'],
      ['2026-06-01T00:00:00.000Z', '2026-06-06T00:00:00.000Z'],
    ]);
  });

  it('produces one window when the range is shorter than a single interval', () => {
    const plan = planHistoryWindows({
      startDate: new Date('2026-06-20T00:00:00Z'),
      endDate: new Date('2026-06-22T00:00:00Z'),
      intervalDays: 30,
    });

    expect(plan.total).toBe(1);
    expect(plan.windows.map(iso)).toEqual([
      ['2026-06-20T00:00:00.000Z', '2026-06-22T00:00:00.000Z'],
    ]);
  });

  it('windows are contiguous and cover exactly the requested range', () => {
    const startDate = new Date('2026-01-15T09:30:00Z');
    const endDate = new Date('2026-06-22T00:00:00Z');
    const plan = planHistoryWindows({ startDate, endDate, intervalDays: 14 }, 100);

    expect(plan.windows[0]?.end).toEqual(endDate);
    expect(plan.windows[plan.windows.length - 1]?.start).toEqual(startDate);
    // No gaps, no overlaps: each window's start is the next one's end.
    for (let i = 1; i < plan.windows.length; i++) {
      expect(plan.windows[i]?.end).toEqual(plan.windows[i - 1]?.start);
    }
  });

  it('stays contiguous across a DST transition', () => {
    // US DST ends 2026-11-01. Windows are pure elapsed-time slices, so a local
    // clock shift can move a boundary by an hour but can never open a gap.
    const plan = planHistoryWindows({
      startDate: new Date('2026-10-25T04:00:00Z'),
      endDate: new Date('2026-11-08T05:00:00Z'),
      intervalDays: 3,
    }, 100);

    for (let i = 1; i < plan.windows.length; i++) {
      expect(plan.windows[i]?.end).toEqual(plan.windows[i - 1]?.start);
    }
    expect(plan.windows[plan.windows.length - 1]?.start).toEqual(new Date('2026-10-25T04:00:00Z'));
  });

  it('returns an empty plan when the start is on or after the end', () => {
    const same = new Date('2026-06-22T00:00:00Z');
    expect(planHistoryWindows({ startDate: same, endDate: same, intervalDays: 7 }))
      .toEqual({ windows: [], total: 0, truncated: false });

    expect(planHistoryWindows({
      startDate: new Date('2026-07-01T00:00:00Z'),
      endDate: new Date('2026-06-22T00:00:00Z'),
      intervalDays: 7,
    })).toEqual({ windows: [], total: 0, truncated: false });
  });

  it('caps the plan at maxWindows and keeps the newest ones', () => {
    const plan = planHistoryWindows({
      startDate: new Date('2020-06-22T00:00:00Z'),
      endDate: new Date('2026-06-22T00:00:00Z'),
      intervalDays: 7,
    }, 5);

    // 6 years spanning one leap day (2024-02-29) = 2191 days = 313 weekly windows.
    expect(plan.total).toBe(Math.ceil((6 * 365 + 1) / 7));
    expect(plan.truncated).toBe(true);
    expect(plan.windows).toHaveLength(5);
    // Newest kept: the first window still ends at endDate.
    expect(plan.windows[0]?.end).toEqual(new Date('2026-06-22T00:00:00Z'));
    expect(plan.windows[4]?.start).toEqual(new Date('2026-05-18T00:00:00Z'));
  });

  it('defaults to the MAX_HISTORY_WINDOWS cap', () => {
    const plan = planHistoryWindows({
      startDate: new Date('2024-06-22T00:00:00Z'),
      endDate: new Date('2026-06-22T00:00:00Z'),
      intervalDays: 7,
    });

    expect(plan.windows).toHaveLength(MAX_HISTORY_WINDOWS);
    expect(plan.truncated).toBe(true);
  });

  it('rejects a non-positive or fractional interval', () => {
    const range = {
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-22T00:00:00Z'),
    };
    expect(() => planHistoryWindows({ ...range, intervalDays: 0 })).toThrow(/positive integer/);
    expect(() => planHistoryWindows({ ...range, intervalDays: -7 })).toThrow(/positive integer/);
    expect(() => planHistoryWindows({ ...range, intervalDays: 1.5 })).toThrow(/positive integer/);
  });

  it('rejects a non-positive maxWindows', () => {
    const input = {
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-22T00:00:00Z'),
      intervalDays: 7,
    };
    expect(() => planHistoryWindows(input, 0)).toThrow(/maxWindows/);
  });

  it('rejects invalid dates', () => {
    expect(() => planHistoryWindows({
      startDate: new Date('not-a-date'),
      endDate: new Date('2026-06-22T00:00:00Z'),
      intervalDays: 7,
    })).toThrow(/valid dates/);
  });
});
