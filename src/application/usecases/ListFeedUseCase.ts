import type { Media } from '../../domain/entities/Media';
import type { IMediaRepository } from '../../domain/interfaces';
import type { FeedPostingDto } from '../dtos';

/**
 * Rows written before posting_id existed carry no grouping; consecutive items
 * uploaded within this window are treated as one posting.
 */
const LEGACY_GROUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Builds the Home feed: a publisher's media grouped into "postings" — the
 * batch shared together in one send — newest first. Items stamped with a
 * postingId group on it; legacy items fall back to a created-at time window.
 */
export class ListFeedUseCase {
  constructor(private readonly mediaRepo: IMediaRepository) {}

  async list(publisherId: string): Promise<FeedPostingDto[]> {
    if (!publisherId) throw new Error('publisherId is required');
    const media = await this.mediaRepo.findByOwner(publisherId);
    const sorted = [...media].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const groups: Media[][] = [];
    const byPostingId = new Map<string, Media[]>();
    for (const item of sorted) {
      const postingId = item.postingId;
      if (postingId != null) {
        const existing = byPostingId.get(postingId);
        if (existing != null) {
          existing.push(item);
        } else {
          const group = [item];
          byPostingId.set(postingId, group);
          groups.push(group);
        }
        continue;
      }
      // Legacy row: join the previous group when it is also legacy and close in time.
      const last = groups[groups.length - 1];
      const lastItem = last?.[last.length - 1];
      if (
        last != null && lastItem != null && lastItem.postingId == null &&
        lastItem.createdAt.getTime() - item.createdAt.getTime() <= LEGACY_GROUP_WINDOW_MS
      ) {
        last.push(item);
      } else {
        groups.push([item]);
      }
    }

    return groups.map(group => this.toPosting(group));
  }

  private toPosting(group: Media[]): FeedPostingDto {
    const newest = group[0] as Media; // groups are built non-empty, newest first
    return {
      id: newest.postingId ?? `legacy-${newest.id}`,
      createdAt: newest.createdAt.toISOString(),
      location: group.find(m => m.location != null)?.location ?? null,
      media: group.map(m => ({ id: m.id, url: m.url, mediaType: m.mediaType })),
    };
  }
}
