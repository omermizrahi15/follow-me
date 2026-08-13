/**
 * Which photos make the next post — the pure core of the product.
 *
 * DUAL RUNTIME. This module is the single implementation of the selection
 * rules: the React Native app reaches it through `PhotoSelectionService`, and
 * the Deno `auto-post` Edge Function imports this exact file. It must therefore
 * stay import-free and free of platform globals — see CONTRIBUTING.md.
 *
 * The two runtimes hold a classified photo in different shapes (the app has a
 * `PhotoClassification` with a nested candidate and a `Date`; the server has a
 * flat database row with epoch millis), so rather than convert either one,
 * callers pass a `facts` projection and get their own objects back.
 *
 * selectBatch runs three passes in order so the batch is always as full as
 * possible without ever returning 0 when photos exist:
 *
 *  Pass 1 — ideal selection
 *    Round-robin across enabled categories (in configured priority order),
 *    highest quality first, with scene dedup to avoid nearly-identical shots.
 *
 *  Pass 2 — scene-overflow bypass
 *    If the quota is still unmet, re-scan enabled categories ignoring scene
 *    dedup. Same-scene duplicates are added rather than leaving slots empty.
 *
 *  Pass 3 — 'other' fallback
 *    If still short, fill from photos the classifier labelled 'other'. These
 *    are a last resort so the batch is never empty when photos exist.
 */

/** Everything the selection rules need to know about one photo. */
export interface PhotoFacts {
  /** Stable asset id — what `alreadySent` is keyed on. */
  id: string;
  category: string;
  /** Aesthetic/technical quality, 0..1. */
  quality: number;
  /** When the photo was taken, epoch millis. */
  createdAt: number;
  /**
   * 2-4 word slug identifying the scene or subject ("beach-sunset"). Photos of
   * the same moment share a slug so they can be deduplicated. Empty when the
   * classifier didn't produce one, which opts the photo out of scene dedup.
   */
  scene: string;
}

export interface SelectionRules {
  /** Categories to draw from, in priority order (round-robin follows it). */
  enabledCategories: readonly string[];
  photosPerPost: number;
}

/**
 * The classifier's catch-all (screenshots, receipts, blurry shots). Excluded
 * from the ideal passes and used only to avoid an empty batch.
 */
const FALLBACK_CATEGORY = 'other';

interface Entry<T> {
  item: T;
  facts: PhotoFacts;
}

export function selectBatch<T>(
  classifications: readonly T[],
  facts: (item: T) => PhotoFacts,
  rules: SelectionRules,
  alreadySent: ReadonlySet<string>,
): T[] {
  const quota = rules.photosPerPost;
  const enabled = new Set(rules.enabledCategories);
  // Project once — `facts` may be doing real work per photo.
  const entries: Entry<T>[] = classifications.map(item => ({ item, facts: facts(item) }));

  // ── Pass 1: round-robin through enabled categories with scene dedup ───────
  const eligible = entries.filter(
    e =>
      e.facts.category !== FALLBACK_CATEGORY &&
      enabled.has(e.facts.category) &&
      !alreadySent.has(e.facts.id),
  );

  const byCategory = new Map<string, Entry<T>[]>();
  for (const e of eligible) {
    const list = byCategory.get(e.facts.category) ?? [];
    list.push(e);
    byCategory.set(e.facts.category, list);
  }
  for (const list of byCategory.values()) list.sort(rank);

  const queues = rules.enabledCategories.map(category => ({
    items: byCategory.get(category) ?? [],
    pos: 0,
  }));

  const selected: Entry<T>[] = [];
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
        const entry = queue.items[queue.pos];
        if (entry == null) break;
        const scene = sceneKey(entry);
        if (scene === '' || !usedScenes.has(scene)) break;
        queue.pos++;
      }

      const next = queue.items[queue.pos];
      if (next != null) {
        selected.push(next);
        selectedIds.add(next.facts.id);
        queue.pos++;
        exhausted = false;
        const scene = sceneKey(next);
        if (scene !== '') usedScenes.add(scene);
      }
    }
  }

  // ── Pass 2: scene-overflow bypass — same eligible set, skip scene check ───
  if (selected.length < quota) {
    for (const queue of queues) {
      for (let p = 0; p < queue.items.length && selected.length < quota; p++) {
        const entry = queue.items[p];
        if (entry != null && !selectedIds.has(entry.facts.id)) {
          selected.push(entry);
          selectedIds.add(entry.facts.id);
        }
      }
    }
  }

  // ── Pass 3: 'other' fallback — never return empty when photos exist ───────
  if (selected.length < quota) {
    const fallback = entries
      .filter(
        e =>
          e.facts.category === FALLBACK_CATEGORY &&
          !alreadySent.has(e.facts.id) &&
          !selectedIds.has(e.facts.id),
      )
      .sort(rank);
    for (const entry of fallback) {
      if (selected.length >= quota) break;
      selected.push(entry);
      selectedIds.add(entry.facts.id);
    }
  }

  return selected.map(e => e.item);
}

function sceneKey<T>(entry: Entry<T>): string {
  return entry.facts.scene.trim().toLowerCase();
}

/** Best first: quality, then recency, then id so the order is total. */
function rank<T>(a: Entry<T>, b: Entry<T>): number {
  if (b.facts.quality !== a.facts.quality) return b.facts.quality - a.facts.quality;
  if (b.facts.createdAt !== a.facts.createdAt) return b.facts.createdAt - a.facts.createdAt;
  return a.facts.id < b.facts.id ? -1 : a.facts.id > b.facts.id ? 1 : 0;
}
