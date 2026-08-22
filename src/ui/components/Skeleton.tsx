import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';
import { POST_CARD_HEIGHT } from './PostCard';
import { colors, radius, spacing } from '../theme/theme';

/**
 * Placeholders in the shape of the thing that is loading (issue #145).
 *
 * A spinner says "wait" and nothing else; on a slow connection it is
 * indistinguishable from a hang, and it throws the layout away so everything
 * jumps when the content lands. Where the shape is known in advance — a feed of
 * fixed-height cards, a list of follower rows — drawing that shape says how
 * much is coming and keeps the page still.
 *
 * The pulse is a native-driven opacity loop, so it costs nothing on the JS
 * thread while the fetch it is standing in for is running.
 */

const PULSE_MS = 750;

export function Skeleton({
  width = '100%',
  height,
  radius: corner = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: ViewStyle;
}): React.JSX.Element {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: corner, backgroundColor: colors.surfaceAlt, opacity: pulse }, style]}
    />
  );
}

/** Stand-in for the feed's post cards — same height, so nothing shifts. */
export function PostCardSkeleton(): React.JSX.Element {
  return <Skeleton height={POST_CARD_HEIGHT} radius={radius.lg} style={styles.card} />;
}

/**
 * Stand-in for a list row — a leading thumbnail and two lines of text. Covers
 * both list shapes the app has: round avatar (followers) and square cover
 * (deleted posts).
 */
export function ListRowSkeleton({ thumb = 'circle' }: { thumb?: 'circle' | 'square' }): React.JSX.Element {
  const size = thumb === 'circle' ? 38 : 56;
  return (
    <View style={styles.row}>
      <Skeleton width={size} height={size} radius={thumb === 'circle' ? radius.pill : radius.md} />
      <View style={styles.rowText}>
        <Skeleton width="55%" height={13} />
        <Skeleton width="28%" height={10} />
      </View>
    </View>
  );
}

/**
 * `count` copies of a skeleton. Takes a factory rather than an element so each
 * one gets its own animation instance instead of sharing a single value.
 */
export function SkeletonList({
  count,
  render,
}: {
  count: number;
  render: () => React.JSX.Element;
}): React.JSX.Element {
  return (
    <View testID="skeleton-list">
      {Array.from({ length: count }, (_, i) => (
        <React.Fragment key={i}>{render()}</React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowText: { flex: 1, gap: spacing.xs },
});
