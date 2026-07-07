import type { ITwilioClient } from '../infrastructure/notifiers/WhatsAppNotifier';
import type { Media } from '../domain/entities/Media';
import type { Subscriber } from '../domain/entities/Subscriber';
import type { PublisherConfig } from '../domain/entities/PublisherConfig';
import type { PhotoCandidate } from '../domain/entities/PhotoCandidate';
import type { PhotoClassification } from '../domain/entities/PhotoClassification';
import type { CandidatePhoto } from '../domain/entities/CandidatePhoto';
import type { PublisherProfile } from '../domain/entities/PublisherProfile';
import type {
  Coordinate,
  IGeocoder,
  IMediaRepository,
  ISubscriberRepository,
  INotifier,
  IStorageService,
  IPublisherConfigRepository,
  IPublisherProfileRepository,
  IConfirmationSender,
  IMediaLibrary,
  IPhotoClassifier,
  ISentPhotoTracker,
  INotificationScheduler,
  ReminderSchedule,
  ICandidatePhotoRepository,
  INotificationLog,
  NotificationLogEntry,
  RecordedNotificationLogEntry,
} from '../domain/interfaces';

export class InMemoryMediaRepository implements IMediaRepository {
  private store: Map<string, Media> = new Map();

  async save(media: Media): Promise<void> {
    this.store.set(media.id, media);
    return Promise.resolve();
  }

  async findByOwner(ownerId: string): Promise<Media[]> {
    return Promise.resolve([...this.store.values()].filter(m => m.ownerId === ownerId));
  }

  async findById(id: string): Promise<Media | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  all(): Media[] { return [...this.store.values()]; }
}

export class InMemorySubscriberRepository implements ISubscriberRepository {
  private store: Map<string, Subscriber> = new Map();

  async save(subscriber: Subscriber): Promise<void> {
    this.store.set(subscriber.id, subscriber);
    return Promise.resolve();
  }

  async findActiveByPublisher(publisherId: string): Promise<Subscriber[]> {
    return Promise.resolve(
      [...this.store.values()].filter(s => s.publisherId === publisherId && s.isActive())
    );
  }

  async findById(id: string): Promise<Subscriber | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  async findByPublisherAndContact(publisherId: string, contactHandle: string): Promise<Subscriber | null> {
    const found = [...this.store.values()].find(
      s => s.publisherId === publisherId && s.contactHandle === contactHandle,
    );
    return Promise.resolve(found ?? null);
  }

  async findByContactHandle(contactHandle: string): Promise<Subscriber[]> {
    return Promise.resolve(
      [...this.store.values()].filter(s => s.contactHandle === contactHandle),
    );
  }

  all(): Subscriber[] { return [...this.store.values()]; }
}

type ConfirmationKind = 'welcome' | 'unsubscribe' | 'resubscribe';

export class InMemoryConfirmationSender implements IConfirmationSender {
  sent: Array<{ kind: ConfirmationKind; contactHandle: string; publisherName: string }> = [];

  sendWelcome(contactHandle: string, publisherName: string): Promise<void> {
    this.sent.push({ kind: 'welcome', contactHandle, publisherName });
    return Promise.resolve();
  }

  sendUnsubscribeConfirmation(contactHandle: string, publisherName: string): Promise<void> {
    this.sent.push({ kind: 'unsubscribe', contactHandle, publisherName });
    return Promise.resolve();
  }

  sendResubscribeConfirmation(contactHandle: string, publisherName: string): Promise<void> {
    this.sent.push({ kind: 'resubscribe', contactHandle, publisherName });
    return Promise.resolve();
  }

  wasWelcomedAt(contactHandle: string): boolean {
    return this.sent.some(s => s.kind === 'welcome' && s.contactHandle === contactHandle);
  }

  sentOf(kind: ConfirmationKind): Array<{ contactHandle: string; publisherName: string }> {
    return this.sent
      .filter(s => s.kind === kind)
      .map(({ contactHandle, publisherName }) => ({ contactHandle, publisherName }));
  }
}

export class InMemoryNotificationLog implements INotificationLog {
  entries: RecordedNotificationLogEntry[] = [];
  private seq = 0;
  // Fixed clock so recorded timestamps are deterministic in tests.
  private now = '2026-01-01T00:00:00.000Z';

  record(entry: NotificationLogEntry): Promise<void> {
    this.seq += 1;
    this.entries.push({ ...entry, id: `log-${this.seq}`, createdAt: this.now });
    return Promise.resolve();
  }

  findByContact(contactHandle: string): Promise<RecordedNotificationLogEntry[]> {
    return Promise.resolve(this.entries.filter(e => e.contactHandle === contactHandle));
  }

  ofEvent(event: NotificationLogEntry['event']): RecordedNotificationLogEntry[] {
    return this.entries.filter(e => e.event === event);
  }
}

export class InMemoryNotifier implements INotifier {
  sent: Array<{ subscriber: Subscriber; media: Media[] }> = [];

  notify(subscriber: Subscriber, media: Media[]): Promise<void> {
    this.sent.push({ subscriber, media });
    return Promise.resolve();
  }

  wasNotified(subscriberId: string): boolean {
    return this.sent.some(n => n.subscriber.id === subscriberId);
  }
}

export class InMemoryStorageService implements IStorageService {
  async upload(_localUri: string, filename: string): Promise<string> {
    return Promise.resolve(`https://mock-cdn.test/${filename}`);
  }
}

export class FakeGeocoder implements IGeocoder {
  calls: Coordinate[] = [];
  private result: string | null = 'Lisbon, Portugal';
  private queue: Array<string | null> = [];
  private shouldThrow = false;

  returns(place: string | null): void { this.result = place; }
  /** Results for the next calls, in order; falls back to `returns` after. */
  returnsInOrder(...places: Array<string | null>): void { this.queue = places; }
  failOnNextCall(): void { this.shouldThrow = true; }

  reverseGeocode(coordinate: Coordinate): Promise<string | null> {
    this.calls.push(coordinate);
    if (this.shouldThrow) {
      this.shouldThrow = false;
      return Promise.reject(new Error('geocoding service unavailable'));
    }
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift() ?? null);
    return Promise.resolve(this.result);
  }
}

export class InMemoryPublisherConfigRepository implements IPublisherConfigRepository {
  private store: Map<string, PublisherConfig> = new Map();

  async save(config: PublisherConfig): Promise<void> {
    this.store.set(config.publisherId, config);
    return Promise.resolve();
  }

  async findByPublisher(publisherId: string): Promise<PublisherConfig | null> {
    return Promise.resolve(this.store.get(publisherId) ?? null);
  }
}

export class InMemoryPublisherProfileRepository implements IPublisherProfileRepository {
  private store: Map<string, PublisherProfile> = new Map();

  async save(profile: PublisherProfile): Promise<void> {
    this.store.set(profile.publisherId, profile);
    return Promise.resolve();
  }

  async findByPublisher(publisherId: string): Promise<PublisherProfile | null> {
    return Promise.resolve(this.store.get(publisherId) ?? null);
  }
}

type FailureMode =
  | { kind: 'api'; status: number }
  | { kind: 'network' }
  | null;

export class FakeTwilioClient implements ITwilioClient {
  sent: Array<{ to: string; body: string; mediaUrl?: string }> = [];
  private nextFailure: FailureMode = null;
  private failOnCall: number | null = null;
  private callCount = 0;

  failOnNextCall(): void {
    this.nextFailure = { kind: 'api', status: 500 };
  }

  failWithStatus(status: number): void {
    this.nextFailure = { kind: 'api', status };
  }

  failWithNetworkError(): void {
    this.nextFailure = { kind: 'network' };
  }

  failOnCallNumber(n: number): void {
    this.failOnCall = n;
  }

  sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<void> {
    this.callCount += 1;

    const callFailure =
      this.nextFailure ??
      (this.failOnCall === this.callCount ? { kind: 'api' as const, status: 500 } : null);

    if (this.nextFailure != null) this.nextFailure = null;

    if (callFailure?.kind === 'network') {
      return Promise.reject(new TypeError('fetch failed'));
    }
    if (callFailure?.kind === 'api') {
      return Promise.reject(new Error(`Twilio error (${callFailure.status}): request failed`));
    }

    this.sent.push({ to, body, ...(mediaUrl != null ? { mediaUrl } : {}) });
    return Promise.resolve();
  }

  wasSentTo(contactHandle: string): boolean {
    return this.sent.some(s => s.to === contactHandle);
  }
}

export class FakeMediaLibrary implements IMediaLibrary {
  lastLookbackDays: number | null = null;
  constructor(private readonly photos: PhotoCandidate[] = []) {}

  recentPhotos(lookbackDays: number): Promise<PhotoCandidate[]> {
    this.lastLookbackDays = lookbackDays;
    return Promise.resolve(this.photos);
  }
}

/**
 * Returns preset classifications. Maps each input candidate to a classification
 * provided at construction (keyed by candidate id); candidates without an entry
 * are dropped, mirroring a classifier that returns one result per known photo.
 */
export class FakePhotoClassifier implements IPhotoClassifier {
  receivedCandidateIds: string[] = [];
  constructor(private readonly byId: Map<string, PhotoClassification> = new Map()) {}

  classify(
    candidates: PhotoCandidate[],
    onEach?: (result: PhotoClassification, index: number, total: number) => void,
    shouldStop?: () => boolean,
  ): Promise<PhotoClassification[]> {
    this.receivedCandidateIds = [];
    const results: PhotoClassification[] = [];
    const total = candidates.length;
    for (const c of candidates) {
      this.receivedCandidateIds.push(c.id);
      const r = this.byId.get(c.id);
      if (r != null) {
        results.push(r);
        onEach?.(r, results.length, total);
      }
      if (shouldStop?.()) break;
    }
    return Promise.resolve(results);
  }
}

export class FakeSentPhotoTracker implements ISentPhotoTracker {
  constructor(private readonly ids: Set<string> = new Set()) {}
  sentCandidateIds(): Promise<Set<string>> {
    return Promise.resolve(this.ids);
  }
}

export class FakeNotificationScheduler implements INotificationScheduler {
  scheduled: ReminderSchedule | null = null;
  cancelCount = 0;

  scheduleWeeklyReminder(schedule: ReminderSchedule): Promise<void> {
    this.scheduled = schedule;
    return Promise.resolve();
  }

  cancelReminder(): Promise<void> {
    this.cancelCount += 1;
    this.scheduled = null;
    return Promise.resolve();
  }
}

export class FakeStorageService implements IStorageService {
  uploads: { localUri: string; filename: string }[] = [];

  upload(localUri: string, filename: string): Promise<string> {
    this.uploads.push({ localUri, filename });
    return Promise.resolve(`https://cdn.test/uploaded/${filename}`);
  }
}

export class InMemoryCandidatePhotoRepository implements ICandidatePhotoRepository {
  private store: Map<string, CandidatePhoto> = new Map();

  private key(publisherId: string, assetId: string): string {
    return `${publisherId}:${assetId}`;
  }

  saveMany(photos: CandidatePhoto[]): Promise<void> {
    for (const p of photos) this.store.set(this.key(p.publisherId, p.assetId), p);
    return Promise.resolve();
  }

  existingAssetIds(publisherId: string): Promise<Set<string>> {
    const ids = [...this.store.values()]
      .filter(p => p.publisherId === publisherId)
      .map(p => p.assetId);
    return Promise.resolve(new Set(ids));
  }

  recentUrls(publisherId: string, limit: number): Promise<string[]> {
    const urls = [...this.store.values()]
      .filter(p => p.publisherId === publisherId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(p => p.url);
    return Promise.resolve(urls);
  }

  all(): CandidatePhoto[] {
    return [...this.store.values()];
  }
}
