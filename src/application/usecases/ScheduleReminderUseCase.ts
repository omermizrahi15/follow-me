import type { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { INotificationScheduler } from '../../domain/interfaces';

/**
 * (Re)schedules the recurring "time to pick your next post" reminder from the
 * publisher's configured day and time. Call after saving config.
 */
export class ScheduleReminderUseCase {
  constructor(private readonly scheduler: INotificationScheduler) {}

  async execute(config: PublisherConfig): Promise<void> {
    await this.scheduler.scheduleWeeklyReminder({
      dayOfWeek: config.notifyDayOfWeek,
      hour: config.notifyHour,
      minute: config.notifyMinute,
    });
  }

  /** Used when switching to autonomous mode — the server owns scheduling then. */
  async cancel(): Promise<void> {
    await this.scheduler.cancelReminder();
  }
}
