import React, { memo, useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  applyDrag,
  dragTargetIndex,
  toggleAt,
} from '../../../domain/services/categoryOrdering';
import type { OrderedCategory } from '../../../domain/services/categoryOrdering';
import type { PhotoCategory } from '../../../domain/entities/PhotoClassification';
import { colors, radius, spacing } from '../../theme/theme';

/**
 * The publisher's photo categories: tap to enable, drag the handle to reorder.
 *
 * Drag state lives *here*, not in the settings section. `setDragDy` fires on
 * every touch-move event, and while it sat in AutoPostingSection each of those
 * frames re-rendered 900 lines — the whole settings form, every style array,
 * for a gesture that only moves nine rows. Memoised, so a re-render of the
 * section above (an autosave landing, a save-status change) does not touch the
 * list either, as long as the parent keeps `onChange` stable.
 */

const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  selfie_with_view: 'People + view',
  sunset_sunrise: 'Sunset / sunrise',
  architecture: 'Architecture',
  selfie_with_people: 'People',
  food: 'Food & drinks',
  nature: 'Nature',
  night_scene: 'Night scene',
  other: 'Other',
};

/** Row height — the drag maths converts pixels to rows with it. */
const ITEM_H = 48;

interface RowProps {
  cat: PhotoCategory;
  enabled: boolean;
  /** Vertical shift for this row while a drag is in progress. */
  translateY: number;
  /** This is the row being dragged — it floats above the others. */
  isGhost: boolean;
  /** A drag is in progress anywhere in the list, so taps are ignored. */
  isDragging: boolean;
  index: number;
  onToggle: (index: number) => void;
  onDragStart: (index: number, pageY: number) => void;
  onDragMove: (pageY: number) => void;
  onDragEnd: (pageY: number | null) => void;
}

const CategoryRow = memo(function CategoryRow({
  cat, enabled, translateY, isGhost, isDragging, index,
  onToggle, onDragStart, onDragMove, onDragEnd,
}: RowProps): React.JSX.Element {
  return (
    <View
      style={[
        styles.catRow,
        isGhost && styles.catRowGhost,
        { transform: [{ translateY }], zIndex: isGhost ? 10 : 1 },
      ]}
    >
      <TouchableOpacity
        testID={`auto-cat-${cat}`}
        onPress={() => !isDragging && onToggle(index)}
        style={styles.catCheck}
        activeOpacity={0.7}
        hitSlop={4}
      >
        <View style={[styles.checkbox, enabled && styles.checkboxActive]}>
          {enabled && <Ionicons name="checkmark" size={12} color="#fff" />}
        </View>
      </TouchableOpacity>
      <Text style={[styles.catLabel, !enabled && styles.catLabelOff]} numberOfLines={1}>
        {CATEGORY_LABELS[cat]}
      </Text>
      {/* Drag handle — capturing responder here, not on the row */}
      <View
        style={styles.dragHandle}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e: GestureResponderEvent) => onDragStart(index, e.nativeEvent.pageY)}
        onResponderMove={(e: GestureResponderEvent) => onDragMove(e.nativeEvent.pageY)}
        onResponderRelease={(e: GestureResponderEvent) => onDragEnd(e.nativeEvent.pageY)}
        onResponderTerminate={() => onDragEnd(null)}
      >
        <Ionicons name="menu" size={18} color={enabled ? colors.textSecondary : colors.border} />
      </View>
    </View>
  );
});

interface Props {
  value: OrderedCategory[];
  onChange: (next: OrderedCategory[]) => void;
  /** Told when a drag starts/ends so the enclosing scroll view can stand down. */
  onDraggingChange?: (dragging: boolean) => void;
}

export const CategoryReorderList = memo(function CategoryReorderList({
  value, onChange, onDraggingChange,
}: Props): React.JSX.Element {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragDy, setDragDy] = useState(0);
  const startYRef = useRef<number | null>(null);
  // Mirrors `dragFrom` so the release handler can commit without reading state
  // inside a setState updater — updaters must stay pure.
  const dragFromRef = useRef<number | null>(null);
  // Stable handles on the latest props, so the row callbacks below never
  // change identity — a new callback per render would defeat the row memo.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;

  const isDragging = dragFrom !== null;
  const dragTo = dragFrom !== null ? dragTargetIndex(value, dragFrom, dragDy / ITEM_H) : null;

  const onToggle = useCallback((index: number) => {
    onChangeRef.current(toggleAt(valueRef.current, index));
  }, []);

  const onDragStart = useCallback((index: number, pageY: number) => {
    startYRef.current = pageY;
    dragFromRef.current = index;
    setDragFrom(index);
    setDragDy(0);
    onDraggingChangeRef.current?.(true);
  }, []);

  const onDragMove = useCallback((pageY: number) => {
    if (startYRef.current == null) return;
    setDragDy(pageY - startYRef.current);
  }, []);

  const onDragEnd = useCallback((pageY: number | null) => {
    const from = dragFromRef.current;
    const startY = startYRef.current;
    dragFromRef.current = null;
    startYRef.current = null;
    // A terminated gesture (pageY null) drops the drag without reordering —
    // the same "put it back" the section did before.
    if (from != null && startY != null && pageY != null) {
      onChangeRef.current(applyDrag(valueRef.current, from, (pageY - startY) / ITEM_H));
    }
    setDragFrom(null);
    setDragDy(0);
    onDraggingChangeRef.current?.(false);
  }, []);

  /** How far a row shifts to open (or close) the gap the dragged row leaves. */
  function shiftOf(i: number): number {
    if (dragFrom === null || dragTo === null) return 0;
    if (i === dragFrom) return dragDy;
    if (dragFrom < dragTo && i > dragFrom && i <= dragTo) return -ITEM_H;
    if (dragFrom > dragTo && i >= dragTo && i < dragFrom) return ITEM_H;
    return 0;
  }

  return (
    <>
      {value.map(({ cat, enabled }, i) => (
        <CategoryRow
          key={cat}
          cat={cat}
          enabled={enabled}
          index={i}
          translateY={shiftOf(i)}
          isGhost={i === dragFrom}
          isDragging={isDragging}
          onToggle={onToggle}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      ))}
    </>
  );
});

const styles = StyleSheet.create({
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ITEM_H,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
  },
  catRowGhost: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  catCheck: { paddingLeft: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  catLabel: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.text },
  catLabelOff: { color: colors.textMuted },
  dragHandle: {
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
