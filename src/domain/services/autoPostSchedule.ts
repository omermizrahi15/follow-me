/**
 * Pure scheduling check for autonomous posting. Given a publisher's weekly
 * schedule (in their own timezone) and the last time we auto-posted, decide
 * whether the current moment is a firing slot. Pure + deterministic (only input
 * is `now`), so it's unit-tested exhaustively. Mirrored by the Deno `_shared`
 * copy used by the auto-post Edge Function.
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
}

/** Cron fires every ~15 min; the window must cover that so a slot isn't missed. */
const DEFAULT_WINDOW_MINUTES = 30;
/** Guards against re-posting within the same day's slot. */
const REFIRE_GUARD_MS = 23 * 60 * 60 * 1000;

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

export function isAutoPostDue(
  input: AutoPostScheduleInput,
  now: Date,
  windowMinutes: number = DEFAULT_WINDOW_MINUTES,
): boolean {
  if (input.lastAutoPostAt != null && now.getTime() - input.lastAutoPostAt.getTime() < REFIRE_GUARD_MS) {
    return false;
  }

  const { weekday, minutesOfDay } = localParts(now, input.timezone);
  if (weekday !== input.dayOfWeek) return false;

  const scheduled = input.hour * 60 + input.minute;
  return minutesOfDay >= scheduled && minutesOfDay < scheduled + windowMinutes;
}
