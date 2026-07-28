import type { Media } from '../entities/Media';
import type { Subscriber } from '../entities/Subscriber';

export interface INotifier {
  notify(subscriber: Subscriber, media: Media[]): Promise<void>;
}

// Messaging-compliance event types recorded in notification_log.
export type NotificationEvent = 'opt_out' | 'opt_in';

export interface NotificationLogEntry {
  subscriberId: string | null;
  publisherId: string;
  contactHandle: string;
  event: NotificationEvent;
  detail?: string;
}

// A previously recorded entry, with the fields the store assigns on write.
export interface RecordedNotificationLogEntry extends NotificationLogEntry {
  id: string;
  createdAt: string; // ISO string
}

// Append-only audit log of opt-out / opt-in events.
export interface INotificationLog {
  record(entry: NotificationLogEntry): Promise<void>;
  findByContact(contactHandle: string): Promise<RecordedNotificationLogEntry[]>;
}

// Delivery tracking (issue #11) — one row per (photo, subscriber) pair in
// notification_deliveries. Distinct from INotificationLog above, which is the
// append-only opt-out/opt-in compliance audit.
export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export interface NotificationDelivery {
  photoId: string;
  subscriberId: string;
  publisherId: string;
}

// A tracked delivery as stored, with the retry bookkeeping columns.
export interface RecordedNotificationDelivery extends NotificationDelivery {
  status: DeliveryStatus;
  attempts: number;
  lastAttemptedAt: string | null; // ISO string
}

/**
 * Tracks WhatsApp delivery status per photo per subscriber. The use case logs
 * pending/sent/failed around each send; the retrying notifier reports each
 * attempt so `attempts`/`last_attempted_at` reflect the real send history.
 */
export interface INotificationLogger {
  /** Insert (or reset, on re-share) entries as 'pending' before sending. */
  logPending(deliveries: NotificationDelivery[]): Promise<void>;
  /** Stamp attempt count + timestamp just before send attempt `attempt` (1-based). */
  recordAttempt(photoIds: string[], subscriberId: string, attempt: number): Promise<void>;
  markSent(photoIds: string[], subscriberId: string): Promise<void>;
  markFailed(photoIds: string[], subscriberId: string): Promise<void>;
  /** Delivery status of one photo across subscribers (feeds the future status UI). */
  findByPhoto(photoId: string): Promise<RecordedNotificationDelivery[]>;
}
