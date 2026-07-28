/** When the next post reminder should fire (local device time). */
export interface ReminderSchedule {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** 24h clock. */
  hour: number;
  minute: number;
  /**
   * Posting cadence in days. Whole-week cadences repeat on `dayOfWeek`;
   * day-count cadences (3, 30) repeat every `intervalDays` instead — they
   * have no natural weekday. Defaults to weekly.
   */
  intervalDays?: number;
}

/** Schedules/cancels the recurring "time to post" reminder notification. */
export interface INotificationScheduler {
  /** Cancel any existing reminder and schedule a new recurring one. */
  scheduleWeeklyReminder(schedule: ReminderSchedule): Promise<void>;
  cancelReminder(): Promise<void>;
}
