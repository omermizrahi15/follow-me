import { SELECTABLE_CATEGORIES } from '../entities/PhotoClassification';
import type { PhotoCategory } from '../entities/PhotoClassification';

/**
 * The publisher's category list as the settings screen shows it: every
 * selectable category exactly once, enabled ones first in preference order,
 * disabled ones after.
 *
 * The list is stored as `enabledCategories` — an ordered subset — so the
 * disabled remainder has to be reconstructed for display, and every edit has
 * to keep the two sections from interleaving. That invariant used to live
 * inside three closures in a 900-line component, where the only way to check
 * it was to drag a row on a device. It is pure list arithmetic, so it lives
 * here instead and is tested directly.
 */
export interface OrderedCategory {
  cat: PhotoCategory;
  enabled: boolean;
}

/** Display order for a stored `enabledCategories`: enabled first, then the rest. */
export function buildOrderedList(enabledInOrder: readonly PhotoCategory[]): OrderedCategory[] {
  const enabledSet = new Set(enabledInOrder);
  return [
    ...enabledInOrder.map(cat => ({ cat, enabled: true })),
    ...SELECTABLE_CATEGORIES.filter(c => !enabledSet.has(c)).map(cat => ({ cat, enabled: false })),
  ];
}

/** The enabled categories, in order — what gets persisted. */
export function enabledCategoriesOf(list: readonly OrderedCategory[]): PhotoCategory[] {
  return list.filter(c => c.enabled).map(c => c.cat);
}

/** Index of the last enabled entry, or -1 when nothing is enabled. */
function lastEnabledIndex(list: readonly OrderedCategory[]): number {
  return list.reduce<number>((acc, c, i) => (c.enabled ? i : acc), -1);
}

/**
 * Where a row dragged `rowsMoved` positions from `from` would land.
 *
 * Clamped to the row's own section, because the two sections are what the
 * stored order means: dragging an enabled category past the last enabled one
 * would otherwise silently disable it, and dragging a disabled one up would
 * enable it — neither of which the publisher asked for by moving a handle.
 */
export function dragTargetIndex(
  list: readonly OrderedCategory[],
  from: number,
  rowsMoved: number,
): number | null {
  const item = list[from];
  if (item == null) return null;
  const firstDisabled = list.findIndex(c => !c.enabled);
  let raw = Math.round(from + rowsMoved);
  if (item.enabled) {
    raw = Math.min(raw, lastEnabledIndex(list));
  } else if (firstDisabled !== -1) {
    raw = Math.max(raw, firstDisabled);
  }
  return Math.max(0, Math.min(list.length - 1, raw));
}

/** Move one entry, returning the same list when the move is a no-op. */
export function reorder(
  list: readonly OrderedCategory[],
  from: number,
  to: number,
): OrderedCategory[] {
  if (to === from) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved == null) return [...list];
  next.splice(to, 0, moved);
  return next;
}

/** Apply a drag of `rowsMoved` rows to the entry at `from`. */
export function applyDrag(
  list: readonly OrderedCategory[],
  from: number,
  rowsMoved: number,
): OrderedCategory[] {
  const to = dragTargetIndex(list, from, rowsMoved);
  if (to == null) return [...list];
  return reorder(list, from, to);
}

/**
 * Flip one entry's enabled state, keeping enabled above disabled.
 *
 * Either direction lands at the same place — just after the last enabled entry
 * in what remains — because that is simultaneously the bottom of the enabled
 * section and the top of the disabled one.
 */
export function toggleAt(list: readonly OrderedCategory[], index: number): OrderedCategory[] {
  const item = list[index];
  if (item == null) return [...list];
  const without = [...list];
  without.splice(index, 1);
  without.splice(lastEnabledIndex(without) + 1, 0, { ...item, enabled: !item.enabled });
  return without;
}
