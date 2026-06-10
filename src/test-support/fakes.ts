import type { Photo } from '../domain/entities/Photo';
import type { Subscriber } from '../domain/entities/Subscriber';
import type {
  IPhotoRepository,
  ISubscriberRepository,
  INotifier,
  IStorageService,
} from '../domain/interfaces';

export class InMemoryPhotoRepository implements IPhotoRepository {
  private store: Map<string, Photo> = new Map();

  async save(photo: Photo): Promise<void> {
    this.store.set(photo.id, photo);
    return Promise.resolve();
  }

  async findByOwner(ownerId: string): Promise<Photo[]> {
    return Promise.resolve([...this.store.values()].filter(p => p.ownerId === ownerId));
  }

  async findById(id: string): Promise<Photo | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  all(): Photo[] { return [...this.store.values()]; }
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
  sent: Array<{ subscriber: Subscriber; photo: Photo }> = [];

  async notify(subscriber: Subscriber, photo: Photo): Promise<void> {
    this.sent.push({ subscriber, photo });
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
