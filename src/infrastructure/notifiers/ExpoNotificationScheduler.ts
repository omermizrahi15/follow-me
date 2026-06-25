import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import type { INotificationScheduler, ReminderSchedule } from '../../domain/interfaces';

/** Stable id so re-scheduling replaces the previous reminder rather than stacking. */
const REMINDER_ID = 'post-reminder';

/** Routed on tap so the app opens straight to the suggestion review screen. */
export const REMINDER_TARGET_SCREEN = 'ReviewSuggestion';

/**
 * Schedules the recurring "time to pick your next post" reminder as a local
 * weekly notification via expo-notifications. Local (not server) — fine for the
 * approval flow; autonomous server-side posting is a separate future path.
 */
export class ExpoNotificationScheduler implements INotificationScheduler {
  async scheduleWeeklyReminder(schedule: ReminderSchedule): Promise<void> {
    const granted = await this.ensurePermission();
    if (!granted) throw new Error('Notification permission not granted');

    await this.cancelReminder();

    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: 'Ready for your next post?',
        body: "We've picked some recent photos for you to review.",
        data: { screen: REMINDER_TARGET_SCREEN },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.WEEKLY,
        // expo weekday is 1-7 (1 = Sunday); domain dayOfWeek is 0-6 (0 = Sunday).
        weekday: schedule.dayOfWeek + 1,
        hour: schedule.hour,
        minute: schedule.minute,
      },
    });
  }

  async cancelReminder(): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  }

  private async ensurePermission(): Promise<boolean> {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  }
}
