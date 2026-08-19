import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing, typography } from '../../theme/theme';

/**
 * "You were in N places" — the offer, and the progress line once it is taken.
 *
 * Deliberately an offer rather than an action: segmentation is a heuristic over
 * GPS, so a wrong guess should cost one dismissal, not an unwanted post.
 */

export function SplitOfferCard({ placeCount, onAccept, onDismiss }: {
  placeCount: number;
  onAccept: () => void;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Ionicons name="git-branch-outline" size={18} color={colors.accent} />
      <View style={styles.copy}>
        <Text style={styles.title}>You were in {placeCount} places</Text>
        <Text style={styles.body}>
          Splitting keeps each place its own story instead of burying the first one.
        </Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          testID="review-split-accept"
          style={styles.primary}
          onPress={onAccept}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Split into ${placeCount} posts`}
        >
          <Text style={styles.primaryText}>Split</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="review-split-dismiss"
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Keep as one post"
        >
          <Text style={styles.secondaryText}>Keep as one</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function SplitProgress({ index, total }: { index: number; total: number }): React.JSX.Element {
  return (
    <View style={styles.legRow}>
      <Ionicons name="location" size={14} color={colors.accent} />
      <Text style={styles.legText}>
        Place {index + 1} of {total}
        {index + 1 < total ? ' — the next follows once you post this' : ' — last one'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.body, fontWeight: '700', color: colors.text },
  body: { ...typography.caption, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  actions: { alignItems: 'flex-end', gap: spacing.xs },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  primaryText: { ...typography.caption, fontWeight: '700', color: colors.onAccent },
  secondaryText: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  legText: { ...typography.caption, fontSize: 12, color: colors.textSecondary, flex: 1 },
});
