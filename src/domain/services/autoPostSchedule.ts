/**
 * Pure scheduling check for autonomous posting. Given a publisher's cadence
 * (in their own timezone) and the last time we auto-posted, decide whether the
 * current moment is a firing slot. Pure + deterministic (only input is `now`),
 * so it's unit-tested exhaustively.
 *
 * DUAL RUNTIME — the Deno `auto-post` Edge Function is the only thing that
 * actually fires on this, and imports this exact file. Keep it import-free; see
 * CONTRIBUTING.md.
 */
export interface AutoPostScheduleInput {
  /** 0 = Sunday … 6 = Saturday (local to `timezone`). */
  dayOfWeek: number;
  hour: number;
  minute: number;
  /** IANA timezone, e.g. 'America/New_York'. */
  timezone: string;
  /** Last successful/attempted auto-post, or null if never. */
  lastAutoPostAt: Date | null;
  /**
   * Posting cadence in days (= the lookback window; defaults to weekly).
   * Whole-week cadences (7, 14) fire on `dayOfWeek`; day-count cadences
   * (3, 30) have no natural weekday, so they fire at the first `hour:minute`
   * slot after a full interval has elapsed — on whatever day that lands.
   */
  intervalDays?: number;
}

/** Cron fires every ~15 min; the window must cover that so a slot isn't missed. */
const DEFAULT_WINDOW_MINUTES = 30;
const HOUR_MS = 60 * 60 * 1000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface LocalParts {
  weekday: number;
  minutesOfDay: number;
}

/** The publisher's local weekday + minute-of-day for `now`, via the IANA tz. */
export function localParts(now: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);

  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  const weekday = WEEKDAYS.indexOf(get('weekday'));
  // hour12:false can yield '24' at midnight in some engines.
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
  // A full interval must elapse between posts, minus 1h of tolerance so DST
  // shifts or cron jitter can't push a slot just out of reach. This also makes
  // biweekly actually fire every OTHER week — the weekday check alone would
  // fire it weekly.
  const minGapMs = (intervalDays * 24 - 1) * HOUR_MS;
  if (input.lastAutoPostAt != null && now.getTime() - input.lastAutoPostAt.getTime() < minGapMs) {
    return false;
  }

  const { weekday, minutesOfDay } = localParts(now, input.timezone);
  if (isWeekdayCadence(intervalDays) && weekday !== input.dayOfWeek) return false;

  const scheduled = input.hour * 60 + input.minute;
  return minutesOfDay >= scheduled && minutesOfDay < scheduled + windowMinutes;
}
