import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoCategory, PhotoClassification } from '../entities/PhotoClassification';

/**
 * Minimum model confidence for a classification to be trusted. Photos the model
 * is unsure about are dropped rather than risk posting a mis-categorised shot.
 */
export const CONFIDENCE_THRESHOLD = 0.5;

/**
 * The pure core of the app: given photos the AI has already classified, pick the
 * batch to suggest for the next post. No AI, no I/O, no clock — fully
 * deterministic so it can be unit-tested exhaustively.
 *
 * Rules, in order:
 *  1. Exclude `other`, disabled categories, low-confidence, low-quality, and
 *     already-sent photos.
 *  2. Diversity: round-robin across the enabled categories, each round taking the
 *     best remaining photo from each category — so a batch isn't all food.
 *  3. Within a category, rank by quality, then recency (newest first).
 *  4. Cap at `photosPerPost`.
 */
export class PhotoSelectionService {
  selectBatch(
    classifications: PhotoClassification[],
    config: PublisherConfig,
    alreadySentIds: Set<string> = new Set(),
  ): PhotoClassification[] {
    const enabled = new Set(config.enabledCategories);

    // 1. Filter.
    const eligible = classifications.filter(
      c =>
        c.category !== 'other' &&
        enabled.has(c.category) &&
        c.confidence >= CONFIDENCE_THRESHOLD &&
        c.quality >= config.minQuality &&
        !alreadySentIds.has(c.candidate.id),
    );

    // 3. Rank within each category (quality desc, then recency desc, then id asc).
    const byCategory = new Map<PhotoCategory, PhotoClassification[]>();
    for (const c of eligible) {
      const list = byCategory.get(c.category) ?? [];
      list.push(c);
      byCategory.set(c.category, list);
    }
    for (const list of byCategory.values()) {
      list.sort(rankWithinCategory);
    }

    // 2. Round-robin across enabled categories in the publisher's configured order.
    const queues = config.enabledCategories.map(cat => ({ items: byCategory.get(cat) ?? [], pos: 0 }));
    const selected: PhotoClassification[] = [];

    let exhausted = false;
    while (selected.length < config.photosPerPost && !exhausted) {
      exhausted = true;
      for (const queue of queues) {
        if (selected.length >= config.photosPerPost) break;
        const next = queue.items[queue.pos];
        if (next !== undefined) {
          selected.push(next);
          queue.pos += 1;
          exhausted = false;
        }
      }
    }

    return selected;
  }
}

function rankWithinCategory(a: PhotoClassification, b: PhotoClassification): number {
  if (b.quality !== a.quality) return b.quality - a.quality;
  const at = a.candidate.createdAt.getTime();
  const bt = b.candidate.createdAt.getTime();
  if (bt !== at) return bt - at;
  return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
}
