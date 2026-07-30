import type { PublisherConfig } from '../entities/PublisherConfig';
import type { PhotoCandidate } from '../entities/PhotoCandidate';
import type { PhotoCategory, PhotoClassification } from '../entities/PhotoClassification';

/**
 * The pure core of the app: given photos the AI has already classified, pick the
 * batch to suggest for the next post. No AI, no I/O, no clock — fully
 * deterministic so it can be unit-tested exhaustively.
 *
 * selectBatch runs three passes in order so the batch is always as full as
 * possible without ever returning 0 when photos exist:
 *
 *  Pass 1 — ideal selection
 *    Round-robin across enabled categories (in configured priority order),
 *    highest quality first, with per-category scene dedup to avoid nearly-
 *    identical shots.
 *
 *  Pass 2 — scene-overflow bypass
 *    If the quota is still unmet, re-scan enabled categories ignoring scene
 *    dedup. Same-scene duplicates are added rather than leaving slots empty.
 *
 *  Pass 3 — 'other' fallback
 *    If still short, fill from photos Gemini labelled 'other'. These are used
 *    as a last resort so the batch is never empty when photos exist.
 */
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
    const enabled = new Set(config.enabledCategories);
    const quota = config.photosPerPost;

    // ── Pass 1: round-robin through enabled categories with scene dedup ───────
    const eligible = classifications.filter(
      c =>
        c.category !== 'other' &&
        enabled.has(c.category) &&
        !alreadySentIds.has(c.candidate.id),
    );

    const byCategory = new Map<PhotoCategory, PhotoClassification[]>();
    for (const c of eligible) {
      const list = byCategory.get(c.category) ?? [];
      list.push(c);
      byCategory.set(c.category, list);
    }
    for (const list of byCategory.values()) list.sort(rankWithinCategory);

    const queues = config.enabledCategories.map(cat => ({
      items: byCategory.get(cat) ?? [],
      pos: 0,
    }));

    const selected: PhotoClassification[] = [];
    const selectedIds = new Set<string>();
    // Global scene set — prevents visually similar shots from appearing twice
    // even when they land in different categories.
    const usedScenes = new Set<string>();

    let exhausted = false;
    while (selected.length < quota && !exhausted) {
      exhausted = true;
      for (const queue of queues) {
        if (selected.length >= quota) break;

        while (queue.pos < queue.items.length) {
          const c = queue.items[queue.pos];
          if (c == null) break;
          const scene = c.scene.trim().toLowerCase();
          if (!scene || !usedScenes.has(scene)) break;
          queue.pos++;
        }

        const next = queue.items[queue.pos];
        if (next != null) {
          selected.push(next);
          selectedIds.add(next.candidate.id);
          queue.pos++;
          exhausted = false;
          const scene = next.scene.trim().toLowerCase();
          if (scene) usedScenes.add(scene);
        }
      }
    }

    // ── Pass 2: scene-overflow bypass — same eligible set, skip scene check ──
    if (selected.length < quota) {
      for (const queue of queues) {
        for (let p = 0; p < queue.items.length && selected.length < quota; p++) {
          const c = queue.items[p];
          if (c != null && !selectedIds.has(c.candidate.id)) {
            selected.push(c);
            selectedIds.add(c.candidate.id);
          }
        }
      }
    }

    // ── Pass 3: 'other' fallback — never return empty when photos exist ───────
    if (selected.length < quota) {
      const otherPhotos = classifications
        .filter(c => c.category === 'other' && !alreadySentIds.has(c.candidate.id) && !selectedIds.has(c.candidate.id))
        .sort(rankWithinCategory);
      for (const c of otherPhotos) {
        if (selected.length >= quota) break;
        selected.push(c);
        selectedIds.add(c.candidate.id);
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
