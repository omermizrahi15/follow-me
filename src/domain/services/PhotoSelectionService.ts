import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoCandidate } from '../entities/PhotoCandidate';
import type { PhotoClassification } from '../entities/PhotoClassification';
import {
  categoryWeight,
  rankAll,
  selectBatch as selectPhotoBatch,
  type PhotoFacts,
} from './photoSelection';

/**
 * Whether a classified photo is worth *offering* to the publisher as one more
 * suggestion — the review screen's "+" slot and the swap chip both draw from
 * photos that pass this.
 *
 * This is now only about categories the publisher switched off. It used to
 * exclude `other` as well, on the reasoning that nothing should volunteer a
 * receipt as "another photo from those days" — but the effect was the opposite
 * of the intent. Photos landed in `other` far more often than expected (a pet,
 * a car, anything not travel-shaped), so they were scanned, graded, paid for,
 * held in the pool, and then hidden. The publisher was told "nothing else worth
 * posting in those days" about a library that still had most of itself left.
 *
 * `other` is offerable now and simply carries a low weight, so it sorts below
 * every real photo and is reached only once those run out. Ranking last is the
 * honest version of what excluding it was trying to do.
 */
export function isSuggestablePhoto(c: PhotoClassification, config: PublisherConfig): boolean {
  return categoryWeight(c.category, config.enabledCategories) > 0;
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
 * types, and owns the burst ordering that runs before classification
 * (device-side only, so it isn't part of the dual-runtime core).
 */
export class PhotoSelectionService {
  /**
   * Photos taken within this of one another are almost certainly the same
   * moment — the shutter held down, or three tries at the same shot.
   */
  private static readonly BURST_GAP_MS = 30_000; // 30 seconds

  /**
   * Orders candidates for grading: one photo per burst first, then the rest.
   *
   * This used to be `deduplicateCandidates`, and it *deleted* the rest. That
   * was wrong twice over. It was never a duplicate check — it compared clocks,
   * not pixels, so two unrelated photos twenty seconds apart lost one, while
   * two near-identical shots forty seconds apart both survived. And because
   * `pendingCandidates` applied the same rule, whatever it dropped could never
   * be reached again: not by the "+", not by a swap, not by a rescan. A trip
   * where the shutter was held down came back as ten photos and a flat "that's
   * every photo from those days".
   *
   * Nothing is dropped now. Burst leaders sort first so a scan stopped by the
   * per-scan cap or the daily quota still spends its budget on distinct
   * moments, and the followers simply queue behind them — graded later if
   * budget allows, or on demand when the publisher swaps that deep. Each tier
   * is newest-first for the same reason the scan is: a truncated run should
   * spend what it has on recent photos.
   *
   * Choosing the *best* of a burst is deliberately not done here. It needs a
   * grade, and no grade exists before classification — the pixels aren't even
   * reachable on-device without decoding them. That job belongs to the ranking
   * and the per-scene cap in ./photoSelection, which run after grading and use
   * the classifier's own `scene` slug, a signal built to make photos of one
   * place collide.
   */
  gradingOrder(candidates: PhotoCandidate[]): PhotoCandidate[] {
    const sorted = [...candidates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const leaders: PhotoCandidate[] = [];
    const followers: PhotoCandidate[] = [];
    let lastLeaderAt: number | null = null;
    for (const curr of sorted) {
      const at = curr.createdAt.getTime();
      if (lastLeaderAt == null || at - lastLeaderAt >= PhotoSelectionService.BURST_GAP_MS) {
        leaders.push(curr);
        lastLeaderAt = at;
      } else {
        followers.push(curr);
      }
    }
    leaders.reverse();
    followers.reverse();
    return [...leaders, ...followers];
  }

  /** How many distinct moments `candidates` covers — the burst leaders. */
  distinctMoments(candidates: PhotoCandidate[]): number {
    const sorted = [...candidates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let count = 0;
    let lastLeaderAt: number | null = null;
    for (const curr of sorted) {
      const at = curr.createdAt.getTime();
      if (lastLeaderAt == null || at - lastLeaderAt >= PhotoSelectionService.BURST_GAP_MS) {
        count++;
        lastLeaderAt = at;
      }
    }
    return count;
  }

  selectBatch(
    classifications: PhotoClassification[],
    config: PublisherConfig,
    alreadySentIds: Set<string> = new Set(),
  ): PhotoClassification[] {
    return selectPhotoBatch(
      classifications,
      classificationFacts,
      this.rules(config),
      alreadySentIds,
    );
  }

  /**
   * Every photo worth offering, best first — what the swap pool is built from.
   *
   * Shares `selectBatch`'s ordering on purpose. While the two disagreed (the
   * batch was chosen by a category round-robin, the pool sorted by raw
   * quality), swapping a photo could hand back one the rules had already judged
   * worse than the photo it replaced.
   */
  rank(
    classifications: PhotoClassification[],
    config: PublisherConfig,
    alreadySentIds: Set<string> = new Set(),
  ): PhotoClassification[] {
    return rankAll(classifications, classificationFacts, this.rules(config), alreadySentIds);
  }

  private rules(config: PublisherConfig): {
    enabledCategories: string[];
    photosPerPost: number;
    minQuality: number;
  } {
    return {
      enabledCategories: config.enabledCategories,
      photosPerPost: config.photosPerPost,
      minQuality: config.minQuality,
    };
  }
}
