import type { Media } from '../entities/Media';
import type { Subscriber } from '../entities/Subscriber';
import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PublisherProfile } from '../entities/PublisherProfile';

export interface IMediaRepository {
  save(media: Media): Promise<void>;
  findByOwner(ownerId: string): Promise<Media[]>;
  findById(id: string): Promise<Media | null>;
}

export interface ISubscriberRepository {
  save(subscriber: Subscriber): Promise<void>;
  findActiveByPublisher(publisherId: string): Promise<Subscriber[]>;
  findById(id: string): Promise<Subscriber | null>;
  findByPublisherAndContact(publisherId: string, contactHandle: string): Promise<Subscriber | null>;
  // Every subscription tied to a phone number, across publishers. Used to act on
  // an inbound STOP/START where we only know the sender's number.
  findByContactHandle(contactHandle: string): Promise<Subscriber[]>;
}

export interface IConfirmationSender {
  sendWelcome(contactHandle: string, publisherName: string): Promise<void>;
  sendUnsubscribeConfirmation(contactHandle: string, publisherName: string): Promise<void>;
  sendResubscribeConfirmation(contactHandle: string, publisherName: string): Promise<void>;
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

export interface INotifier {
  notify(subscriber: Subscriber, media: Media[]): Promise<void>;
}

export interface IStorageService {
  upload(localUri: string, filename: string): Promise<string>;
}

export interface IPublisherConfigRepository {
  save(config: PublisherConfig): Promise<void>;
  findByPublisher(publisherId: string): Promise<PublisherConfig | null>;
}

export interface IPublisherProfileRepository {
  save(profile: PublisherProfile): Promise<void>;
  findByPublisher(publisherId: string): Promise<PublisherProfile | null>;
}
