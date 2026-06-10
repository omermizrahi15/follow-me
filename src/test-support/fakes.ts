import type { ITwilioClient } from '../infrastructure/notifiers/WhatsAppNotifier';
import type { Media } from '../domain/entities/Media';
import type { Subscriber } from '../domain/entities/Subscriber';
import type {
  IMediaRepository,
  ISubscriberRepository,
  INotifier,
  IStorageService,
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

  all(): Subscriber[] { return [...this.store.values()]; }
}

export class InMemoryNotifier implements INotifier {
  sent: Array<{ subscriber: Subscriber; media: Media }> = [];

  notify(subscriber: Subscriber, media: Media): Promise<void> {
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

type FailureMode =
  | { kind: 'api'; status: number }
  | { kind: 'network' }
  | null;

export class FakeTwilioClient implements ITwilioClient {
  sent: Array<{ to: string; body: string; mediaUrl?: string }> = [];
  private nextFailure: FailureMode = null;

  failOnNextCall(): void {
    this.nextFailure = { kind: 'api', status: 500 };
  }

  failWithStatus(status: number): void {
    this.nextFailure = { kind: 'api', status };
  }

  failWithNetworkError(): void {
    this.nextFailure = { kind: 'network' };
  }

  sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<void> {
    const failure = this.nextFailure;
    this.nextFailure = null;

    if (failure?.kind === 'network') {
      return Promise.reject(new TypeError('fetch failed'));
    }
    if (failure?.kind === 'api') {
      return Promise.reject(new Error(`Twilio error (${failure.status}): request failed`));
    }

    this.sent.push({ to, body, ...(mediaUrl != null ? { mediaUrl } : {}) });
    return Promise.resolve();
  }

  wasSentTo(contactHandle: string): boolean {
    return this.sent.some(s => s.to === contactHandle);
  }
}
