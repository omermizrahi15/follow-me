import {
  startOfDay,
  startOfMonth,
  addMonths,
  isSameDay,
  daysInMonth,
  monthWeeks,
  isWithin,
  clampMonth,
} from './calendarMonth';

/** Local-time construction, matching how the picker builds every date. */
const local = (y: number, m: number, d: number): Date => new Date(y, m - 1, d);

describe('startOfDay / startOfMonth', () => {
  it('strips the time, keeping the local calendar day', () => {
    const noon = new Date(2026, 5, 14, 13, 45, 30, 500);
    expect(startOfDay(noon)).toEqual(local(2026, 6, 14));
  });

  it('is idempotent', () => {
    const d = startOfDay(new Date(2026, 5, 14, 9));
    expect(startOfDay(d)).toEqual(d);
  });

  it('walks back to the 1st of the month', () => {
    expect(startOfMonth(local(2026, 6, 30))).toEqual(local(2026, 6, 1));
  });
});

describe('addMonths', () => {
  it('steps forward and back within a year', () => {
    expect(addMonths(local(2026, 6, 1), 1)).toEqual(local(2026, 7, 1));
    expect(addMonths(local(2026, 6, 1), -1)).toEqual(local(2026, 5, 1));
  });

  it('rolls over year boundaries in both directions', () => {
    expect(addMonths(local(2026, 12, 1), 1)).toEqual(local(2027, 1, 1));
    expect(addMonths(local(2026, 1, 1), -1)).toEqual(local(2025, 12, 1));
  });

  it('steps whole years', () => {
    expect(addMonths(local(2026, 6, 1), -24)).toEqual(local(2024, 6, 1));
  });

  it('never overflows a short month (31 Mar back one month is Feb, not Mar)', () => {
    // Anchoring to the 1st is what avoids the classic `setMonth` overflow bug,
    // where 31 March minus a month lands on 3 March.
    expect(addMonths(local(2026, 3, 31), -1)).toEqual(local(2026, 2, 1));
  });
});

describe('daysInMonth', () => {
  it('knows the ordinary month lengths', () => {
    expect(daysInMonth(local(2026, 1, 1))).toBe(31);
    expect(daysInMonth(local(2026, 4, 1))).toBe(30);
  });

  it('handles February in common and leap years', () => {
    expect(daysInMonth(local(2026, 2, 1))).toBe(28);
    expect(daysInMonth(local(2024, 2, 1))).toBe(29);
    // Century rule: 1900 was not a leap year, 2000 was.
    expect(daysInMonth(local(1900, 2, 1))).toBe(28);
    expect(daysInMonth(local(2000, 2, 1))).toBe(29);
  });
});

describe('monthWeeks', () => {
  it('pads the first week so the 1st sits under its real weekday', () => {
    // 1 June 2026 is a Monday, so exactly one blank (Sunday) leads the grid.
    const weeks = monthWeeks(local(2026, 6, 1));
    expect(weeks[0]?.[0]).toBeNull();
    expect(weeks[0]?.[1]).toEqual(local(2026, 6, 1));
  });

  it('needs no lead-in when the month starts on a Sunday', () => {
    // 1 February 2026 is a Sunday.
    const weeks = monthWeeks(local(2026, 2, 1));
    expect(weeks[0]?.[0]).toEqual(local(2026, 2, 1));
  });

  it('emits whole weeks, padding the tail with nulls', () => {
    for (const month of [local(2026, 2, 1), local(2026, 6, 1), local(2024, 2, 1)]) {
      const weeks = monthWeeks(month);
      weeks.forEach(week => expect(week).toHaveLength(7));
    }
  });

  it('contains every day of the month exactly once, in order', () => {
    const weeks = monthWeeks(local(2026, 6, 1));
    const days = weeks.flat().filter((d): d is Date => d != null);

    expect(days).toHaveLength(30);
    expect(days[0]).toEqual(local(2026, 6, 1));
    expect(days[29]).toEqual(local(2026, 6, 30));
    days.forEach((d, i) => expect(d.getDate()).toBe(i + 1));
  });

  it('borrows no days from the neighbouring months', () => {
    const days = monthWeeks(local(2026, 6, 1)).flat().filter((d): d is Date => d != null);
    expect(days.every(d => d.getMonth() === 5)).toBe(true);
  });

  it('covers a leap February', () => {
    const days = monthWeeks(local(2024, 2, 1)).flat().filter((d): d is Date => d != null);
    expect(days).toHaveLength(29);
    expect(days[28]).toEqual(local(2024, 2, 29));
  });

  it('spans six rows when a 31-day month starts late in the week', () => {
    // 1 August 2026 is a Saturday: 1 lead blank + 31 days needs six rows.
    expect(monthWeeks(local(2026, 8, 1))).toHaveLength(6);
  });
});

describe('isWithin', () => {
  const min = local(2024, 1, 1);
  const max = local(2026, 6, 14);

  it('includes both endpoints', () => {
    expect(isWithin(min, min, max)).toBe(true);
    expect(isWithin(max, min, max)).toBe(true);
  });

  it('excludes days outside the range', () => {
    expect(isWithin(local(2023, 12, 31), min, max)).toBe(false);
    expect(isWithin(local(2026, 6, 15), min, max)).toBe(false);
  });

  it('compares by day, ignoring the time of day', () => {
    // Later on the max day is still the max day — a picker must not reject
    // "today" just because the clock has moved past midnight.
    expect(isWithin(new Date(2026, 5, 14, 23, 59), min, max)).toBe(true);
  });
});

describe('clampMonth', () => {
  const min = local(2024, 3, 10);
  const max = local(2026, 6, 14);

  it('pins a month before the range to the minimum month', () => {
    expect(clampMonth(local(2020, 1, 1), min, max)).toEqual(local(2024, 3, 1));
  });

  it('pins a month after the range to the maximum month', () => {
    expect(clampMonth(local(2030, 1, 1), min, max)).toEqual(local(2026, 6, 1));
  });

  it('leaves an in-range month alone, normalised to the 1st', () => {
    expect(clampMonth(local(2025, 9, 22), min, max)).toEqual(local(2025, 9, 1));
  });

  it('allows the boundary months themselves', () => {
    expect(clampMonth(local(2024, 3, 31), min, max)).toEqual(local(2024, 3, 1));
    expect(clampMonth(local(2026, 6, 1), min, max)).toEqual(local(2026, 6, 1));
  });
});

describe('isSameDay', () => {
  it('matches on the calendar day regardless of time', () => {
    expect(isSameDay(new Date(2026, 5, 14, 1), new Date(2026, 5, 14, 23))).toBe(true);
  });

  it('does not match across days, months or years', () => {
    expect(isSameDay(local(2026, 6, 14), local(2026, 6, 15))).toBe(false);
    expect(isSameDay(local(2026, 6, 14), local(2026, 7, 14))).toBe(false);
    expect(isSameDay(local(2026, 6, 14), local(2025, 6, 14))).toBe(false);
  });
});
