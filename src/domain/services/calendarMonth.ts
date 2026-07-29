/**
 * Pure calendar arithmetic for the in-app date picker. No clock, no React, no
 * locale lookups — every input is explicit, so leap years, month lengths and
 * week alignment are all exhaustively unit-testable.
 *
 * Everything works in LOCAL time. A publisher picking "1 June" means midnight
 * on the first of June where they were standing, not 00:00 UTC — those are
 * different instants, and the backfill windows are cut from the one the
 * publisher meant.
 */

/** Midnight local on the day `d` falls in. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Midnight local on the 1st of `d`'s month. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * The same day-of-month `delta` months away. Always anchored to the 1st, so
 * there is no "31 March minus one month" ambiguity to resolve.
 */
export function addMonths(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Days in `d`'s month — day 0 of the next month is the last of this one. */
export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * The month laid out as calendar weeks, Sunday first. Cells outside the month
 * are null so the grid keeps its shape without borrowing neighbouring days —
 * tapping a greyed-out 31st of the previous month is a classic mis-tap, and
 * there is nothing to tap here.
 */
export function monthWeeks(month: Date): (Date | null)[][] {
  const first = startOfMonth(month);
  const cells: (Date | null)[] = [];

  // Blank lead-in so the 1st lands under its real weekday column.
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let day = 1; day <= daysInMonth(first); day++) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Whether `day` is inside `[min, max]`, compared by day and not by instant. */
export function isWithin(day: Date, min: Date, max: Date): boolean {
  const d = startOfDay(day).getTime();
  return d >= startOfDay(min).getTime() && d <= startOfDay(max).getTime();
}

/** `month` pinned into the months that contain `min`/`max`. */
export function clampMonth(month: Date, min: Date, max: Date): Date {
  const m = startOfMonth(month).getTime();
  const lo = startOfMonth(min);
  const hi = startOfMonth(max);
  if (m < lo.getTime()) return lo;
  if (m > hi.getTime()) return hi;
  return startOfMonth(month);
}
