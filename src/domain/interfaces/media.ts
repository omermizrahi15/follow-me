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

/**
 * The copy of a posting that followers see — the row behind the web gallery
 * link every WhatsApp message carries. Written server-side when the batch is
 * sent; the app only ever hides and unhides it.
 *
 * Separate from IMediaRepository because it is a separate store with a separate
 * lifecycle: `media` is the publisher's own feed, this is what was published.
 * Trashing has to reach both, or the publisher deletes a post and their
 * followers keep seeing it.
 */
export interface IPostGalleryRepository {
  /**
   * Hides the posting's gallery row (`deletedAt` set) or brings it back (null).
   * Owner-scoped like the media write. A posting with no gallery row — a
   * backfilled posting, or one sent before the posting id was recorded —
   * matches nothing, which is success: there is nothing for followers to see.
   */
  setPostingDeleted(publisherId: string, postingId: string, deletedAt: Date | null): Promise<void>;
}

export interface IStorageService {
  upload(localUri: string, filename: string): Promise<string>;
}
