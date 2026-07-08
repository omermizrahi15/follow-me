import { assert, assertEquals } from '@std/assert';
import { isAutoPostDue, localParts } from './autoPostSchedule.ts';

// 2026-01-05 is a Monday (weekday index 1, WEEKDAYS starts at 'Sun').
const MON_0900_UTC = new Date('2026-01-05T09:00:00Z');

Deno.test('localParts — weekday + minutes-of-day in the given timezone', () => {
  const { weekday, minutesOfDay } = localParts(MON_0900_UTC, 'UTC');
  assertEquals(weekday, 1);
  assertEquals(minutesOfDay, 9 * 60);
});

Deno.test('due inside the window on the scheduled day', () => {
  const now = new Date('2026-01-05T09:10:00Z');
  assert(isAutoPostDue({ dayOfWeek: 1, hour: 9, minute: 0, timezone: 'UTC', lastAutoPostAt: null }, now));
});

Deno.test('not due before the scheduled time', () => {
  const now = new Date('2026-01-05T08:50:00Z');
  assert(!isAutoPostDue({ dayOfWeek: 1, hour: 9, minute: 0, timezone: 'UTC', lastAutoPostAt: null }, now));
});

Deno.test('not due on the wrong weekday', () => {
  const now = new Date('2026-01-06T09:10:00Z'); // Tuesday
  assert(!isAutoPostDue({ dayOfWeek: 1, hour: 9, minute: 0, timezone: 'UTC', lastAutoPostAt: null }, now));
});

Deno.test('refire guard — not due if it already fired within 23h', () => {
  const now = new Date('2026-01-05T09:10:00Z');
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  assert(!isAutoPostDue({ dayOfWeek: 1, hour: 9, minute: 0, timezone: 'UTC', lastAutoPostAt: oneHourAgo }, now));
});
