import type { Media } from '../entities/Media';

export interface IMediaRepository {
  save(media: Media): Promise<void>;
  /** Every item the owner has, trashed ones included — callers filter. */
  findByOwner(ownerId: string): Promise<Media[]>;
  findById(id: string): Promise<Media | null>;
  /**
   * Moves a whole posting to the trash (`deletedAt` set) or restores it
   * (null), in one write. A posting is deleted as a unit — it is what the
   * publisher sees as "a post" — and the owner scopes the write, so one
   * publisher can never trash another's posting by guessing its id.
   */
  setPostingDeleted(ownerId: string, postingId: string, deletedAt: Date | null): Promise<void>;
}

export interface IStorageService {
  upload(localUri: string, filename: string): Promise<string>;
}
