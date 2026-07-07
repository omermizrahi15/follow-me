import type { Media } from '../entities/Media';
import type { Subscriber } from '../entities/Subscriber';
import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoCandidate } from '../entities/PhotoCandidate';
import type { PhotoClassification } from '../entities/PhotoClassification';
import type { CandidatePhoto } from '../entities/CandidatePhoto';
import type { PublisherProfile } from '../entities/PublisherProfile';

export interface IMediaRepository {
  save(media: Media): Promise<void>;
  findByOwner(ownerId: string): Promise<Media[]>;
  findById(id: string): Promise<Media | null>;
}

export interface ISubscriberRepository {
  save(subscriber: Subscriber): Promise<void>;
  findActiveByPublisher(publisherId: string): Promise<Subscriber[]>;
  /** Every subscription of the publisher regardless of status — the Followers
   *  list needs revoked filtered out but unreachable shown (issue #24). */
  findByPublisher(publisherId: string): Promise<Subscriber[]>;
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

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface IGeocoder {
  /** Human place label ("City, Country") for a coordinate; null when unresolvable. */
  reverseGeocode(coordinate: Coordinate): Promise<string | null>;
}

export interface IPublisherConfigRepository {
  save(config: PublisherConfig): Promise<void>;
  findByPublisher(publisherId: string): Promise<PublisherConfig | null>;
}

/** Classifies candidate photos into rule categories with confidence/quality. */
export interface IPhotoClassifier {
  /**
   * @param onEach     Called after each photo is classified (index is 1-based,
   *                   total is the full candidate count).
   * @param shouldStop When provided, called after each result. If it returns
   *                   true, classification stops early (batch quota reached).
   */
  classify(
    candidates: PhotoCandidate[],
    onEach?: (result: PhotoClassification, index: number, total: number) => void,
    shouldStop?: () => boolean,
  ): Promise<PhotoClassification[]>;
}

/** Reads photos from the device library within a recency window. */
export interface IMediaLibrary {
  /** Photos created within the last `lookbackDays`, newest first. */
  recentPhotos(lookbackDays: number): Promise<PhotoCandidate[]>;
}

/**
 * Yields the candidate ids that have already been shared, so they're excluded
 * from new suggestions. Backed by the `media` table once a photo has been sent.
 */
export interface ISentPhotoTracker {
  sentCandidateIds(publisherId: string): Promise<Set<string>>;
}

/**
 * Stores cloud copies of recent library photos so the server can post them
 * autonomously. Deduped by asset id within the publisher's lookback window.
 */
export interface ICandidatePhotoRepository {
  saveMany(photos: CandidatePhoto[]): Promise<void>;
  existingAssetIds(publisherId: string): Promise<Set<string>>;
  /** Most recently created candidate photo URLs (newest first). */
  recentUrls(publisherId: string, limit: number): Promise<string[]>;
}

/** Resolves a candidate to a uri the storage service can read (e.g. ph:// → file://). */
export type ResolveLocalUri = (candidate: PhotoCandidate) => Promise<string>;

/** When the next post reminder should fire (local device time). */
export interface ReminderSchedule {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** 24h clock. */
  hour: number;
  minute: number;
}

/** Schedules/cancels the recurring "time to post" reminder notification. */
export interface INotificationScheduler {
  /** Cancel any existing reminder and schedule a new weekly one. */
  scheduleWeeklyReminder(schedule: ReminderSchedule): Promise<void>;
  cancelReminder(): Promise<void>;
}

export interface IPublisherProfileRepository {
  save(profile: PublisherProfile): Promise<void>;
  findByPublisher(publisherId: string): Promise<PublisherProfile | null>;
}
