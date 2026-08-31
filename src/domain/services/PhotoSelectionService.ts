import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoCandidate } from '../entities/PhotoCandidate';
import type { PhotoClassification } from '../entities/PhotoClassification';
import { bestFirst } from './burstRanking';
import {
  categoryWeight,
  rankAll,
  selectBatch as selectPhotoBatch,
  type PhotoFacts,
  type SelectionRules,
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
 *
 * `photosOfMe: 'only'` is the one other exclusion, and it is here for the same
 * reason the category gate is: `selectBatch` will not put a photo without the
 * publisher in a post, so offering one as "another photo from those days" hands
 * back a "+" slot and a swap chip that produce a batch the publisher was told
 * they'd never get. `prefer` excludes nothing — it is a tilt, and the pool is
 * ordered by that tilt already.
 */
export function isSuggestablePhoto(c: PhotoClassification, config: PublisherConfig): boolean {
  if (config.photosOfMe === 'only' && !c.containsPublisher) return false;
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
    containsPublisher: c.containsPublisher,
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
   * WHICH frame of a burst leads is decided by `burstRanking` — from device
   * metadata alone, no model call and no pixels. It used to be whichever was
   * shot first, which is close to the worst available choice: the first frame
   * of a held shutter is the one taken while the phone was still coming up. So
   * the AI spent its scarcest resource grading the clumsiest frame of every
   * moment, and the keeper sat in the ungraded tail behind it.
   *
   * Still an ordering, never a filter. The per-scene cap in ./photoSelection
   * runs after grading and uses the classifier's own `scene` slug; this is the
   * cheap pass in front of it that decides what grading is spent on.
   */
  gradingOrder(candidates: PhotoCandidate[]): PhotoCandidate[] {
    const bursts = this.bursts(candidates);
    const leaders: PhotoCandidate[] = [];
    // Kept per burst rather than flattened, so reversing puts the newest MOMENT
    // first without also reversing the ranking inside it — flattening first and
    // reversing the lot handed back each burst's also-rans worst-first, which
    // is the opposite of what a swap should reach for.
    const alsoRans: PhotoCandidate[][] = [];
    for (const burst of bursts) {
      const [best, ...rest] = bestFirst(burst);
      // A burst always holds at least one photo, so `best` is never undefined —
      // but the array destructuring cannot know that.
      if (best != null) leaders.push(best);
      alsoRans.push(rest);
    }
    leaders.reverse();
    const followers = alsoRans.reverse().flat();
    return [...leaders, ...followers];
  }

  /**
   * The candidates split into moments, oldest moment first, each burst in
   * chronological order.
   *
   * A new burst starts when a photo lands `BURST_GAP_MS` or more after the one
   * that OPENED the current burst — not after the previous photo, which would
   * chain a slow sequence of shots into one endless moment.
   */
  private bursts(candidates: PhotoCandidate[]): PhotoCandidate[][] {
    const sorted = [...candidates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const groups: PhotoCandidate[][] = [];
    let openedAt: number | null = null;
    for (const curr of sorted) {
      const at = curr.createdAt.getTime();
      if (openedAt == null || at - openedAt >= PhotoSelectionService.BURST_GAP_MS) {
        groups.push([curr]);
        openedAt = at;
      } else {
        groups[groups.length - 1]?.push(curr);
      }
    }
    return groups;
  }

  /**
   * The photos that share a moment with at least one other — the only ones
   * worth a per-asset metadata lookup.
   *
   * Reading a photo's file size and favourite flag costs a round trip to the
   * library per asset, and doing that across a whole window is the unbounded
   * work pattern that has watchdog-killed this app before. It is also pointless
   * for a moment shot once: `bestFirst` has nothing to choose between. On an
   * ordinary library the bursts are a small minority of the window, so this
   * turns "one lookup per photo" into "one lookup per photo that needs one".
   */
  burstMembers(candidates: PhotoCandidate[]): PhotoCandidate[] {
    return this.bursts(candidates)
      .filter(burst => burst.length > 1)
      .flat();
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

  private rules(config: PublisherConfig): SelectionRules {
    return {
      enabledCategories: config.enabledCategories,
      photosPerPost: config.photosPerPost,
      minQuality: config.minQuality,
      photosOfMe: config.photosOfMe,
    };
  }
}
