import {
  applyDrag,
  buildOrderedList,
  dragTargetIndex,
  enabledCategoriesOf,
  reorder,
  toggleAt,
} from './categoryOrdering';
import type { OrderedCategory } from './categoryOrdering';
import { SELECTABLE_CATEGORIES } from '../entities/PhotoClassification';
import type { PhotoCategory } from '../entities/PhotoClassification';

/** Compact fixture: "a b | c d" — enabled before the bar, disabled after. */
function list(spec: string): OrderedCategory[] {
  const [on = '', off = ''] = spec.split('|');
  const parse = (s: string, enabled: boolean): OrderedCategory[] =>
    s
      .trim()
      .split(/\s+/)
      .filter(t => t !== '')
      .map(cat => ({ cat: cat as PhotoCategory, enabled }));
  return [...parse(on, true), ...parse(off, false)];
}

const show = (l: readonly OrderedCategory[]): string =>
  l.map(c => `${c.cat}${c.enabled ? '' : '-'}`).join(' ');

describe('buildOrderedList', () => {
  it('puts the stored order first and the untouched categories after', () => {
    const result = buildOrderedList(['food', 'nature']);

    expect(result.slice(0, 2)).toEqual([
      { cat: 'food', enabled: true },
      { cat: 'nature', enabled: true },
    ]);
    expect(result.slice(2).every(c => !c.enabled)).toBe(true);
  });

  it('lists every selectable category exactly once', () => {
    const result = buildOrderedList(['nature']);

    expect(result).toHaveLength(SELECTABLE_CATEGORIES.length);
    expect(new Set(result.map(c => c.cat)).size).toBe(SELECTABLE_CATEGORIES.length);
  });

  it('round-trips through enabledCategoriesOf', () => {
    const stored: PhotoCategory[] = ['night_scene', 'food', 'architecture'];

    expect(enabledCategoriesOf(buildOrderedList(stored))).toEqual(stored);
  });

  it('handles nothing enabled', () => {
    const result = buildOrderedList([]);

    expect(result.every(c => !c.enabled)).toBe(true);
    expect(enabledCategoriesOf(result)).toEqual([]);
  });
});

describe('dragTargetIndex', () => {
  const l = list('food nature | cultural other');

  it('follows the drag inside the enabled section', () => {
    expect(dragTargetIndex(l, 0, 1)).toBe(1);
  });

  it('will not drag an enabled row past the last enabled one', () => {
    // Dragging "food" three rows down would land it among the disabled rows,
    // which would silently switch it off.
    expect(dragTargetIndex(l, 0, 3)).toBe(1);
  });

  it('will not drag a disabled row above the first disabled one', () => {
    expect(dragTargetIndex(l, 3, -3)).toBe(2);
  });

  it('clamps to the ends of the list', () => {
    expect(dragTargetIndex(l, 1, -99)).toBe(0);
    expect(dragTargetIndex(l, 2, 99)).toBe(3);
  });

  it('rounds a part-row drag to the nearest row', () => {
    expect(dragTargetIndex(l, 0, 0.4)).toBe(0);
    expect(dragTargetIndex(l, 0, 0.6)).toBe(1);
  });

  it('returns null for an index that is not in the list', () => {
    expect(dragTargetIndex(l, 9, 1)).toBeNull();
  });

  it('lets a disabled row move freely when nothing is enabled', () => {
    expect(dragTargetIndex(list('| a b c'), 2, -2)).toBe(0);
  });
});

describe('applyDrag', () => {
  it('moves the row to where the drag pointed', () => {
    expect(show(applyDrag(list('a b c |'), 0, 2))).toBe('b c a');
  });

  it('keeps an over-dragged enabled row inside the enabled section', () => {
    expect(show(applyDrag(list('a b | c d'), 0, 3))).toBe('b a c- d-');
  });

  it('leaves the list alone when the row does not move', () => {
    expect(show(applyDrag(list('a b | c'), 1, 0))).toBe('a b c-');
  });

  it('never mutates the input', () => {
    const before = list('a b | c');
    applyDrag(before, 0, 1);

    expect(show(before)).toBe('a b c-');
  });
});

describe('reorder', () => {
  it('moves an entry down', () => {
    expect(show(reorder(list('a b c |'), 0, 2))).toBe('b c a');
  });

  it('moves an entry up', () => {
    expect(show(reorder(list('a b c |'), 2, 0))).toBe('c a b');
  });
});

describe('toggleAt', () => {
  it('disabling drops the row to the top of the disabled section', () => {
    expect(show(toggleAt(list('a b c | d'), 0))).toBe('b c a- d-');
  });

  it('enabling lifts the row to the bottom of the enabled section', () => {
    expect(show(toggleAt(list('a b | c d'), 3))).toBe('a b d c-');
  });

  it('enabling the only row when nothing is enabled puts it first', () => {
    expect(show(toggleAt(list('| a b c'), 2))).toBe('c a- b-');
  });

  it('disabling the last enabled row leaves nothing enabled', () => {
    expect(enabledCategoriesOf(toggleAt(list('a | b'), 0))).toEqual([]);
  });

  it('is its own inverse for the first row', () => {
    const start = list('a b | c');
    const once = toggleAt(start, 0);

    expect(show(toggleAt(once, once.findIndex(c => String(c.cat) === 'a')))).toBe('b a c-');
  });

  it('ignores an index that is not in the list', () => {
    expect(show(toggleAt(list('a | b'), 7))).toBe('a b-');
  });

  it('never mutates the input', () => {
    const before = list('a b | c');
    toggleAt(before, 0);

    expect(show(before)).toBe('a b c-');
  });
});
