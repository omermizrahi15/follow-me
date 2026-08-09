import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoCandidate } from '../entities/PhotoCandidate';
import type { PhotoClassification } from '../entities/PhotoClassification';
import { selectBatch as selectPhotoBatch, type PhotoFacts } from './photoSelection';

/**
 * Whether a classified photo is worth *offering* to the publisher as one more
 * suggestion — the review screen's "+" slot and the swap chip both draw from
 * photos that pass this.
 *
 * Stricter than what `selectBatch` may end up with: pass 3 falls back to
 * `other` (screenshots, receipts, blurry shots) rather than leave a suggested
 * post empty, but nothing should volunteer a receipt as "another photo from
 * those days". Same for categories the publisher switched off. Offering either
 * would make the empty state — no more relevant photos — a lie.
 */
export function isSuggestablePhoto(c: PhotoClassification, config: PublisherConfig): boolean {
  return c.category !== 'other' && config.enabledCategories.includes(c.category);
}

/** How the app's classification shape answers the selection rules' questions. */
function classificationFacts(c: PhotoClassification): PhotoFacts {
  return {
    id: c.candidate.id,
    category: c.category,
    quality: c.quality,
    createdAt: c.candidate.createdAt.getTime(),
    scene: c.scene,
  };
}

/**
 * The app's door onto the selection rules. The rules themselves live in
 * ./photoSelection, which the auto-post Edge Function imports directly — this
 * class only adapts them to the app's `PhotoClassification` / `PublisherConfig`
 * types, and owns the burst dedup that runs before classification (device-side
 * only, so it isn't part of the dual-runtime core).
 */
export class PhotoSelectionService {
  /**
   * Collapses burst shots before AI classification — photos taken within
   * BURST_GAP_MS of each other are almost certainly the same moment. Keeping
   * only the first of each group drastically reduces the number of AI calls
   * without losing meaningful variety (scene-hash dedup in selectBatch handles
   * any survivors that still look alike).
   */
  private static readonly BURST_GAP_MS = 30_000; // 30 seconds

  deduplicateCandidates(candidates: PhotoCandidate[]): PhotoCandidate[] {
    const sorted = [...candidates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const result: PhotoCandidate[] = [];
    let prev: PhotoCandidate | undefined;
    for (const curr of sorted) {
      if (prev == null || curr.createdAt.getTime() - prev.createdAt.getTime() >= PhotoSelectionService.BURST_GAP_MS) {
        result.push(curr);
        prev = curr;
      }
    }
    return result;
  }

  selectBatch(
    classifications: PhotoClassification[],
    config: PublisherConfig,
    alreadySentIds: Set<string> = new Set(),
  ): PhotoClassification[] {
    return selectPhotoBatch(
      classifications,
      classificationFacts,
      {
        enabledCategories: config.enabledCategories,
        photosPerPost: config.photosPerPost,
      },
      alreadySentIds,
    );
  }
}
