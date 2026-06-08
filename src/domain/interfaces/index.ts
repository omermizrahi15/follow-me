import type { Photo } from '../entities/Photo';
import type { Subscriber } from '../entities/Subscriber';

export interface IPhotoRepository {
  save(photo: Photo): Promise<void>;
  findByOwner(ownerId: string): Promise<Photo[]>;
  findById(id: string): Promise<Photo | null>;
}

export interface ISubscriberRepository {
  save(subscriber: Subscriber): Promise<void>;
  findActiveByPublisher(publisherId: string): Promise<Subscriber[]>;
  findById(id: string): Promise<Subscriber | null>;
}

export interface INotifier {
  notify(subscriber: Subscriber, photo: Photo): Promise<void>;
}

export interface IStorageService {
  upload(localUri: string, filename: string): Promise<string>;
}