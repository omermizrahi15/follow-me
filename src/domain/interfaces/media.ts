import type { Media } from '../entities/Media';

/**
 * A window over the owner's media, newest first. Reads are always bounded:
 * a feed grows without limit, and the one query that ignored that is what made
 * opening Home cost more every month (issue #116).
 */
export interface MediaWindow {
  /** How many rows to read. */
  limit: number;
  /** How many rows to skip; 0 (the default) is the newest row. */
  offset?: number;
}

export interface IMediaRepository {
  /**
   * Writes a whole posting in one request, all or nothing. A posting is shared
   * as a batch of up to 15 photos; one request per photo was 15 round-trips,
   * and a failure partway left orphan rows behind with nothing to clean them
   * up. Callers may pass an empty batch — it writes nothing and succeeds.
   */
  saveMany(media: Media[]): Promise<void>;
  /** A window of the owner's items, newest first, trashed ones included — callers filter. */
  findByOwner(ownerId: string, window: MediaWindow): Promise<Media[]>;
  /** Every item of one posting, newest first — resolving a single post without reading the feed. */
  findByPosting(ownerId: string, postingId: string): Promise<Media[]>;
  /**
   * Ids only, of everything the owner has ever posted — the whole set, since
   * the question ("was this asset already sent?") is about all of history.
   * A projection rather than `findByOwner` because that is all the answer
   * needs: the ids are asset ids, and reading entire rows to keep one column
   * was the app's heaviest repeated query.
   */
  postedAssetIds(ownerId: string): Promise<Set<string>>;
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
