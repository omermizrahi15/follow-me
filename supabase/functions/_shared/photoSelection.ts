// Deno mirror of src/domain/services/PhotoSelectionService.ts.
// KEEP IN SYNC with the domain version (guarded by a jest parity test).
// Self-contained (no imports) so it runs in Deno and is importable by Node.

export type SharedCategory =
  | 'selfie_with_view'
  | 'selfie_with_people'
  | 'view_only'
  | 'food'
  | 'other';

export interface SharedClassification {
  assetId: string;
  url: string;
  category: SharedCategory;
  confidence: number;
  quality: number;
  /** epoch ms */
  createdAt: number;
}

export interface SharedSelectionConfig {
  enabledCategories: SharedCategory[];
  minQuality: number;
  photosPerPost: number;
}

export const CONFIDENCE_THRESHOLD = 0.5;

export function selectBatch(
  classifications: SharedClassification[],
  config: SharedSelectionConfig,
  alreadySent: Set<string>,
): SharedClassification[] {
  const enabled = new Set(config.enabledCategories);

  const eligible = classifications.filter(
    c =>
      c.category !== 'other' &&
      enabled.has(c.category) &&
      c.confidence >= CONFIDENCE_THRESHOLD &&
      c.quality >= config.minQuality &&
      !alreadySent.has(c.assetId),
  );

  const byCategory = new Map<SharedCategory, SharedClassification[]>();
  for (const c of eligible) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  for (const list of byCategory.values()) {
    list.sort(rank);
  }

  const queues = config.enabledCategories.map(cat => ({ items: byCategory.get(cat) ?? [], pos: 0 }));
  const selected: SharedClassification[] = [];

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

function rank(a: SharedClassification, b: SharedClassification): number {
  if (b.quality !== a.quality) return b.quality - a.quality;
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0;
}
