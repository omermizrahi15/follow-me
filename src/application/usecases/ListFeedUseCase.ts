import type { Media } from '../../domain/entities/Media';
import type { IMediaRepository, MediaWindow } from '../../domain/interfaces';
import type { FeedPostingDto } from '../dtos';

/**
 * How many media rows one page reads. Sized in rows, not postings, because
 * that is what the query is billed in: ~8 full postings, comfortably more than
 * a screenful, and small enough that a publisher with years of travel never
 * pulls their whole history into memory at once.
 */
export const FEED_PAGE_ROWS = 120;

/** One page of the feed, plus where the next one starts. */
export interface FeedPage {
  postings: FeedPostingDto[];
  /**
   * Row offset to ask for next, or null when the store had nothing more.
   *
   * Rows, not postings: a posting whose photos straddle the page boundary
   * comes back split across two pages, so whoever stitches pages together has
   * to merge the boundary posting on its id (see `mergeFeedPages`).
   */
  nextOffset: number | null;
}

/**
 * Builds the Home feed: a publisher's media grouped into "postings" — the
 * batch shared together in one send — newest first, grouped on postingId.
 *
 * Every stored media item carries a postingId: ShareMediaUseCase stamps it on
 * upload and the database enforces NOT NULL, so a missing one is a bug (a
 * write that bypassed the share flow), not data — it throws.
 *
 * Trashed postings (`deletedAt` set) are left out of the feed and listed by
 * `listDeleted` instead. Both read the same rows and group them the same way;
 * they differ only in which side of the filter they keep.
 *
 * Reads come a page at a time (issue #116). The feed only grows, and reading
 * all of it to render the first screenful got slower with every trip.
 */
export class ListFeedUseCase {
  constructor(private readonly mediaRepo: IMediaRepository) {}

  /** Live postings, newest first — the Me feed and the globe. */
  async list(publisherId: string, window?: Partial<MediaWindow>): Promise<FeedPage> {
    return this.group(publisherId, m => !m.isDeleted, window);
  }

  /**
   * Trashed postings, most recently deleted first — Settings → Deleted posts.
   * A posting is trashed as a unit, so any item carrying `deletedAt` marks the
   * whole group; a partial state could only come from a half-applied write.
   *
   * Ordering is by deletion time within the page. Pages are read in posting
   * order, so a publisher who has deleted more than a page of photos sees the
   * page boundaries fall by post date — the trash is a recovery list, not a
   * timeline, and stitching it in deletion order would mean reading all of it.
   */
  async listDeleted(publisherId: string, window?: Partial<MediaWindow>): Promise<FeedPage> {
    const page = await this.group(publisherId, m => m.isDeleted, window);
    // ISO-8601 in UTC sorts lexicographically, and every deletedAt is written
    // by toISOString() — no need to parse dates back out of the DTO.
    return {
      ...page,
      postings: page.postings.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')),
    };
  }

  /**
   * One posting by id, or null when the publisher has no live posting under it.
   *
   * Its own query rather than a scan of the feed: this backs the screen a
   * "Posted ✅" push opens, where the posting wanted is known up front and the
   * rest of the feed is never looked at.
   */
  async posting(publisherId: string, postingId: string): Promise<FeedPostingDto | null> {
    if (!publisherId) throw new Error('publisherId is required');
    const media = await this.mediaRepo.findByPosting(publisherId, postingId);
    const live = this.newestFirst(media.filter(m => !m.isDeleted));
    if (live.length === 0) return null;
    return this.toPosting(postingId, live);
  }

  private async group(
    publisherId: string,
    keep: (media: Media) => boolean,
    window?: Partial<MediaWindow>,
  ): Promise<FeedPage> {
    if (!publisherId) throw new Error('publisherId is required');
    const limit = window?.limit ?? FEED_PAGE_ROWS;
    const offset = window?.offset ?? 0;
    const rows = await this.mediaRepo.findByOwner(publisherId, { limit, offset });
    // A short page means the store is exhausted. A full one may or may not be
    // the last — worst case the caller makes one more request that comes back
    // empty, which is cheaper than counting the table to find out.
    const nextOffset = rows.length === limit ? offset + rows.length : null;
    const sorted = this.newestFirst(rows.filter(keep));

    // Insertion order of the map follows the newest-first sort, so the
    // resulting postings stay newest-first too.
    const groups = new Map<string, Media[]>();
    for (const item of sorted) {
      const postingId = item.postingId;
      if (postingId == null) {
        throw new Error(`media ${item.id} has no postingId — it must be stamped at share time`);
      }
      const group = groups.get(postingId);
      if (group != null) group.push(item);
      else groups.set(postingId, [item]);
    }

    return {
      postings: [...groups.entries()].map(([postingId, group]) => this.toPosting(postingId, group)),
      nextOffset,
    };
  }

  /**
   * The repository already orders rows this way; sorting again keeps the
   * grouping correct whatever a given implementation returns.
   */
  private newestFirst(media: Media[]): Media[] {
    return [...media].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private toPosting(postingId: string, group: Media[]): FeedPostingDto {
    const newest = group[0] as Media; // groups are built non-empty, newest first
    return {
      id: postingId,
      createdAt: newest.createdAt.toISOString(),
      location: group.find(m => m.location != null)?.location ?? null,
      // One point per posting — the batch is a single stop on the route, so the
      // first item with a fix represents it. Items in a batch are metres apart.
      coordinate: group.find(m => m.coordinate != null)?.coordinate ?? null,
      deletedAt: group.find(m => m.deletedAt != null)?.deletedAt?.toISOString() ?? null,
      media: group.map(m => ({ id: m.id, url: m.url })),
    };
  }
}
