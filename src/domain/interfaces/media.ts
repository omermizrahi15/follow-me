import type { Media } from '../entities/Media';

export interface IMediaRepository {
  save(media: Media): Promise<void>;
  findByOwner(ownerId: string): Promise<Media[]>;
  findById(id: string): Promise<Media | null>;
}

export interface IStorageService {
  upload(localUri: string, filename: string): Promise<string>;
}
