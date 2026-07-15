// Deno mirror of src/domain/services/autoPostSchedule.ts.
// KEEP IN SYNC with the domain version (guarded by a jest parity test).

export interface AutoPostScheduleInput {
  dayOfWeek: number;
  hour: number;
  minute: number;
  timezone: string;
  lastAutoPostAt: Date | null;
  /** Posting cadence in days (defaults to weekly). 7/14 fire on dayOfWeek; 3/30 by elapsed days. */
  intervalDays?: number;
}

const DEFAULT_WINDOW_MINUTES = 30;
const HOUR_MS = 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(now: Date, timezone: string): { weekday: number; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);

  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  const weekday = WEEKDAYS.indexOf(get('weekday'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { weekday, minutesOfDay: hour * 60 + minute };
}

/** Whether a cadence fires on a fixed weekday (weekly/biweekly) or by elapsed days. */
export function isWeekdayCadence(intervalDays: number): boolean {
  return intervalDays % 7 === 0;
}

export function isAutoPostDue(
  input: AutoPostScheduleInput,
  now: Date,
  windowMinutes: number = DEFAULT_WINDOW_MINUTES,
): boolean {
  const intervalDays = input.intervalDays ?? 7;
  // Full interval minus 1h tolerance (DST/cron jitter). Also makes biweekly
  // actually fire every OTHER week — the weekday check alone fires weekly.
  const minGapMs = (intervalDays * 24 - 1) * HOUR_MS;
  if (input.lastAutoPostAt != null && now.getTime() - input.lastAutoPostAt.getTime() < minGapMs) {
    return false;
  }
  const { weekday, minutesOfDay } = localParts(now, input.timezone);
  if (isWeekdayCadence(intervalDays) && weekday !== input.dayOfWeek) return false;
  const scheduled = input.hour * 60 + input.minute;
  return minutesOfDay >= scheduled && minutesOfDay < scheduled + windowMinutes;
}
