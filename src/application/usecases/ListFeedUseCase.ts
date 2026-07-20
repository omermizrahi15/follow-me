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
 */
export class ListFeedUseCase {
  constructor(private readonly mediaRepo: IMediaRepository) {}

  async list(publisherId: string): Promise<FeedPostingDto[]> {
    if (!publisherId) throw new Error('publisherId is required');
    const media = await this.mediaRepo.findByOwner(publisherId);
    const sorted = [...media].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

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
      media: group.map(m => ({ id: m.id, url: m.url })),
    };
  }
}
