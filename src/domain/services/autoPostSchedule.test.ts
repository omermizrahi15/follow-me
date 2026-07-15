import { isAutoPostDue } from './autoPostSchedule';
import type { AutoPostScheduleInput } from './autoPostSchedule';

// 2026-06-21 is a Sunday. 14:00 UTC = 10:00 in America/New_York (EDT, -4).
const base: AutoPostScheduleInput = {
  dayOfWeek: 0, // Sunday
  hour: 10,
  minute: 0,
  timezone: 'America/New_York',
  lastAutoPostAt: null,
};

describe('isAutoPostDue', () => {
  it('fires at the scheduled local time', () => {
    const now = new Date('2026-06-21T14:00:00Z'); // Sun 10:00 EDT
    expect(isAutoPostDue(base, now)).toBe(true);
  });

  it('fires anywhere inside the window', () => {
    const now = new Date('2026-06-21T14:20:00Z'); // Sun 10:20 EDT, within 30-min window
    expect(isAutoPostDue(base, now)).toBe(true);
  });

  it('does not fire before the scheduled time', () => {
    const now = new Date('2026-06-21T13:50:00Z'); // Sun 09:50 EDT
    expect(isAutoPostDue(base, now)).toBe(false);
  });

  it('does not fire after the window closes', () => {
    const now = new Date('2026-06-21T14:40:00Z'); // Sun 10:40 EDT, past 30-min window
    expect(isAutoPostDue(base, now)).toBe(false);
  });

  it('does not fire on the wrong weekday', () => {
    const now = new Date('2026-06-22T14:00:00Z'); // Monday 10:00 EDT
    expect(isAutoPostDue(base, now)).toBe(false);
  });

  it('respects the timezone (same UTC instant is a different local hour)', () => {
    // 14:00 UTC is 16:00 in Europe/Berlin (CEST, +2) — not 10:00.
    const berlin: AutoPostScheduleInput = { ...base, timezone: 'Europe/Berlin' };
    expect(isAutoPostDue(berlin, new Date('2026-06-21T14:00:00Z'))).toBe(false);
    // 08:00 UTC = 10:00 Berlin
    expect(isAutoPostDue(berlin, new Date('2026-06-21T08:00:00Z'))).toBe(true);
  });

  it('does not re-fire within the refire guard (same slot)', () => {
    const now = new Date('2026-06-21T14:15:00Z');
    const input: AutoPostScheduleInput = {
      ...base,
      lastAutoPostAt: new Date('2026-06-21T14:00:00Z'),
    };
    expect(isAutoPostDue(input, now)).toBe(false);
  });

  it('fires again the following week (past the refire guard)', () => {
    const now = new Date('2026-06-28T14:00:00Z'); // next Sunday
    const input: AutoPostScheduleInput = {
      ...base,
      lastAutoPostAt: new Date('2026-06-21T14:00:00Z'),
    };
    expect(isAutoPostDue(input, now)).toBe(true);
  });
});

describe('isAutoPostDue — day-count cadences (every N days, no weekday)', () => {
  const every3: AutoPostScheduleInput = { ...base, intervalDays: 3 };

  it('ignores the configured weekday — fires at the time slot on ANY day', () => {
    // Wednesday, not the configured Sunday.
    const now = new Date('2026-06-24T14:00:00Z'); // Wed 10:00 EDT
    expect(isAutoPostDue(every3, now)).toBe(true);
  });

  it('never posted → due at the first matching time slot', () => {
    const now = new Date('2026-06-22T14:10:00Z'); // Monday, inside window
    expect(isAutoPostDue(every3, now)).toBe(true);
  });

  it('does not fire again before the interval has elapsed', () => {
    const input: AutoPostScheduleInput = {
      ...every3,
      lastAutoPostAt: new Date('2026-06-21T14:00:00Z'),
    };
    // Only 2 days later — the 10:00 slot passes but the 3-day gap hasn't.
    expect(isAutoPostDue(input, new Date('2026-06-23T14:00:00Z'))).toBe(false);
  });

  it('fires at the first slot after the interval elapses', () => {
    const input: AutoPostScheduleInput = {
      ...every3,
      lastAutoPostAt: new Date('2026-06-21T14:00:00Z'),
    };
    expect(isAutoPostDue(input, new Date('2026-06-24T14:00:00Z'))).toBe(true); // day 3
  });

  it('still respects the time-of-day window', () => {
    const input: AutoPostScheduleInput = {
      ...every3,
      lastAutoPostAt: new Date('2026-06-20T14:00:00Z'),
    };
    expect(isAutoPostDue(input, new Date('2026-06-24T20:00:00Z'))).toBe(false); // 16:00 EDT ≠ slot
  });
});

describe('isAutoPostDue — biweekly actually skips the in-between week', () => {
  const biweekly: AutoPostScheduleInput = { ...base, intervalDays: 14 };

  it('does not fire on the very next matching weekday', () => {
    const input: AutoPostScheduleInput = {
      ...biweekly,
      lastAutoPostAt: new Date('2026-06-21T14:00:00Z'),
    };
    expect(isAutoPostDue(input, new Date('2026-06-28T14:00:00Z'))).toBe(false); // 1 week later
  });

  it('fires two weeks later', () => {
    const input: AutoPostScheduleInput = {
      ...biweekly,
      lastAutoPostAt: new Date('2026-06-21T14:00:00Z'),
    };
    expect(isAutoPostDue(input, new Date('2026-07-05T14:00:00Z'))).toBe(true); // 2 weeks later
  });
});
