// Deno mirror of src/domain/services/PhotoSelectionService.ts.
// KEEP IN SYNC with the domain version (guarded by a jest parity test).
// Self-contained (no imports) so it runs in Deno and is importable by Node.

// Mirrors PhotoSelectionService.deduplicateCandidates — KEEP IN SYNC.
const BURST_GAP_MS = 30_000;

export interface SharedCandidate {
  id: string;
  /** epoch ms */
  createdAt: number;
}

export function deduplicateCandidates(candidates: SharedCandidate[]): SharedCandidate[] {
  if (candidates.length === 0) return [];
  const sorted = [...candidates].sort((a, b) => a.createdAt - b.createdAt);
  const result: SharedCandidate[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = sorted[i]!;
    if (curr.createdAt - prev.createdAt >= BURST_GAP_MS) result.push(curr);
  }
  return result;
}

export type SharedCategory =
  | 'selfie_with_view'
  | 'sunset_sunrise'
  | 'architecture'
  | 'selfie_with_people'
  | 'food'
  | 'nature'
  | 'night_scene'
  | 'cultural'
  | 'other';

export interface SharedClassification {
  assetId: string;
  url: string;
  category: SharedCategory;
  confidence: number;
  quality: number;
  /** epoch ms */
  createdAt: number;
  scene: string;
}

export interface SharedSelectionConfig {
  enabledCategories: SharedCategory[];
  minQuality: number;
  photosPerPost: number;
}

export function selectBatch(
  classifications: SharedClassification[],
  config: SharedSelectionConfig,
  alreadySent: Set<string>,
): SharedClassification[] {
  const enabled = new Set(config.enabledCategories);
  const quota = config.photosPerPost;

  // ── Pass 1: round-robin through enabled categories with scene dedup ───────
  const eligible = classifications.filter(
    c => c.category !== 'other' && enabled.has(c.category) && !alreadySent.has(c.assetId),
  );

  const byCategory = new Map<SharedCategory, SharedClassification[]>();
  for (const c of eligible) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  for (const list of byCategory.values()) list.sort(rank);

  const queues = config.enabledCategories.map(cat => ({
    items: byCategory.get(cat) ?? [],
    pos: 0,
  }));
  const selected: SharedClassification[] = [];
  const selectedIds = new Set<string>();
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
        selectedIds.add(next.assetId);
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
        if (c != null && !selectedIds.has(c.assetId)) {
          selected.push(c);
          selectedIds.add(c.assetId);
        }
      }
    }
  }

  // ── Pass 3: 'other' fallback — never return empty when photos exist ───────
  if (selected.length < quota) {
    const otherPhotos = classifications
      .filter(c => c.category === 'other' && !alreadySent.has(c.assetId) && !selectedIds.has(c.assetId))
      .sort(rank);
    for (const c of otherPhotos) {
      if (selected.length >= quota) break;
      selected.push(c);
      selectedIds.add(c.assetId);
    }
  }

  return selected;
}

function rank(a: SharedClassification, b: SharedClassification): number {
  if (b.quality !== a.quality) return b.quality - a.quality;
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0;
}
