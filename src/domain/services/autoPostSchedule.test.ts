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
