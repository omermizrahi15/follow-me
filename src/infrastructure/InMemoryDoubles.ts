import { Photo } from '../domain/entities/Photo';
import { Subscriber } from '../domain/entities/Subscriber';
import {
  IPhotoRepository,
  ISubscriberRepository,
  INotifier,
  IStorageService,
} from '../domain/interfaces';

export class InMemoryPhotoRepository implements IPhotoRepository {
  private store: Map<string, Photo> = new Map();

  async save(photo: Photo): Promise<void> {
    this.store.set(photo.id, photo);
  }

  async findByOwner(ownerId: string): Promise<Photo[]> {
    return [...this.store.values()].filter(p => p.ownerId === ownerId);
  }

  async findById(id: string): Promise<Photo | null> {
    return this.store.get(id) ?? null;
  }

  // test helper
  all(): Photo[] { return [...this.store.values()]; }
}

export class InMemorySubscriberRepository implements ISubscriberRepository {
  private store: Map<string, Subscriber> = new Map();

  async save(subscriber: Subscriber): Promise<void> {
    this.store.set(subscriber.id, subscriber);
  }

  async findActiveByPublisher(publisherId: string): Promise<Subscriber[]> {
    return [...this.store.values()].filter(
      s => s.publisherId === publisherId && s.isActive()
    );
  }

  async findById(id: string): Promise<Subscriber | null> {
    return this.store.get(id) ?? null;
  }

  all(): Subscriber[] { return [...this.store.values()]; }
}

export class InMemoryNotifier implements INotifier {
  sent: Array<{ subscriber: Subscriber; photo: Photo }> = [];

  async notify(subscriber: Subscriber, photo: Photo): Promise<void> {
    this.sent.push({ subscriber, photo });
  }

  // test helper — did we notify this subscriber?
  wasNotified(subscriberId: string): boolean {
    return this.sent.some(n => n.subscriber.id === subscriberId);
  }
}

export class InMemoryStorageService implements IStorageService {
  async upload(localUri: string, filename: string): Promise<string> {
    return `https://mock-cdn.test/${filename}`;
  }
}
