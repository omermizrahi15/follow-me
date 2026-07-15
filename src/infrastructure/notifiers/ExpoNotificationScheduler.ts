import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import type { INotificationScheduler, ReminderSchedule } from '../../domain/interfaces';
import { POST_REVIEW_CATEGORY } from './NotificationCategories';

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

    const intervalDays = schedule.intervalDays ?? 7;
    // Day-count cadences (every 3/30 days) have no weekday to anchor on, so
    // they repeat by elapsed time from now. Whole-week cadences anchor on the
    // chosen weekday (biweekly approximates to weekly locally — the server
    // path owns exact spacing; this is the no-push-permission fallback).
    const trigger =
      intervalDays % 7 === 0
        ? {
            type: SchedulableTriggerInputTypes.WEEKLY as const,
            // expo weekday is 1-7 (1 = Sunday); domain dayOfWeek is 0-6 (0 = Sunday).
            weekday: schedule.dayOfWeek + 1,
            hour: schedule.hour,
            minute: schedule.minute,
          }
        : {
            type: SchedulableTriggerInputTypes.TIME_INTERVAL as const,
            seconds: intervalDays * 24 * 60 * 60,
            repeats: true,
          };

    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: 'Ready for your next post?',
        body: "We've picked some recent photos for you to review.",
        categoryIdentifier: POST_REVIEW_CATEGORY,
        interruptionLevel: 'timeSensitive',
        data: { screen: REMINDER_TARGET_SCREEN },
      },
      trigger,
    });
  }

  async cancelReminder(): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  }

  /**
   * DEV ONLY — fires the reminder notification after `seconds` seconds.
   * Pass `localAttachmentUris` (file:// paths) to show photos in the notification.
   * Multiple URIs produce a scrollable filmstrip in the expanded view.
   */
  async scheduleTestIn(seconds: number, localAttachmentUris: string[] = []): Promise<void> {
    const granted = await this.ensurePermission();
    if (!granted) throw new Error('Notification permission not granted');
    await this.cancelReminder();

    // NOTE: the TS type (NotificationContentAttachmentIos) declares `url`/`type`,
    // but the native iOS module reads `uri`/`typeHint` (Records.swift), so the
    // typed keys are silently dropped. Send the keys native actually reads.
    const attachments = localAttachmentUris.map((uri, i) => ({
      identifier: `photo-${i}`,
      uri,
      hideThumbnail: false,
    })) as unknown as Notifications.NotificationContentAttachmentIos[];

    const photoCount = attachments.length;
    const title = photoCount > 0
      ? `${photoCount} photo${photoCount === 1 ? '' : 's'} ready to post 📸`
      : '[DEV] Ready for your next post?';
    const body = "We've pre-selected your best recent shots — tap to review.";

    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title,
        body,
        categoryIdentifier: POST_REVIEW_CATEGORY,
        interruptionLevel: 'timeSensitive',
        attachments,
        data: { screen: REMINDER_TARGET_SCREEN },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
      },
    });
  }

  private async ensurePermission(): Promise<boolean> {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  }
}
