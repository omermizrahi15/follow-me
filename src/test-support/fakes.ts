import type { ITwilioClient } from '../infrastructure/notifiers/WhatsAppNotifier';
import type { Media } from '../domain/entities/Media';
import type { Subscriber } from '../domain/entities/Subscriber';
import type { PublisherConfig } from '../domain/entities/PublisherConfig';
import type {
  IMediaRepository,
  ISubscriberRepository,
  INotifier,
  IStorageService,
  IPublisherConfigRepository,
  IConfirmationSender,
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

  all(): Subscriber[] { return [...this.store.values()]; }
}

export class InMemoryConfirmationSender implements IConfirmationSender {
  sent: Array<{ contactHandle: string; publisherName: string }> = [];

  sendWelcome(contactHandle: string, publisherName: string): Promise<void> {
    this.sent.push({ contactHandle, publisherName });
    return Promise.resolve();
  }

  wasWelcomedAt(contactHandle: string): boolean {
    return this.sent.some(s => s.contactHandle === contactHandle);
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
