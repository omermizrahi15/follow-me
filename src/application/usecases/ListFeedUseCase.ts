import type { Media } from '../../domain/entities/Media';
import type { IMediaRepository } from '../../domain/interfaces';
import type { FeedPostingDto } from '../dtos';

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
 */
export class ListFeedUseCase {
  constructor(private readonly mediaRepo: IMediaRepository) {}

  /** Live postings, newest first — the Me feed and the globe. */
  async list(publisherId: string): Promise<FeedPostingDto[]> {
    return this.group(publisherId, m => !m.isDeleted);
  }

  /**
   * Trashed postings, most recently deleted first — Settings → Deleted posts.
   * A posting is trashed as a unit, so any item carrying `deletedAt` marks the
   * whole group; a partial state could only come from a half-applied write.
   */
  async listDeleted(publisherId: string): Promise<FeedPostingDto[]> {
    const postings = await this.group(publisherId, m => m.isDeleted);
    // ISO-8601 in UTC sorts lexicographically, and every deletedAt is written
    // by toISOString() — no need to parse dates back out of the DTO.
    return postings.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
  }

  private async group(
    publisherId: string,
    keep: (media: Media) => boolean,
  ): Promise<FeedPostingDto[]> {
    if (!publisherId) throw new Error('publisherId is required');
    const media = await this.mediaRepo.findByOwner(publisherId);
    const sorted = media.filter(keep).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

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

    return [...groups.entries()].map(([postingId, group]) => this.toPosting(postingId, group));
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
