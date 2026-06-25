import type { Media } from '../entities/Media';
import type { Subscriber } from '../entities/Subscriber';
import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoCandidate } from '../entities/PhotoCandidate';
import type { PhotoClassification } from '../entities/PhotoClassification';
import type { CandidatePhoto } from '../entities/CandidatePhoto';

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
}

export interface IConfirmationSender {
  sendWelcome(contactHandle: string, publisherName: string): Promise<void>;
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

/** Classifies candidate photos into rule categories with confidence/quality. */
export interface IPhotoClassifier {
  classify(candidates: PhotoCandidate[]): Promise<PhotoClassification[]>;
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
