import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { MAX_PHOTOS_PER_POST } from '../../../domain/entities/PublisherConfig';
import { colors, radius, spacing, typography } from '../../theme/theme';

/**
 * The trailing card of the photo grid: the empty slot, in each of the three
 * states it can be in.
 *
 * It is always there while the post has room — the publisher can go past their
 * configured count, up to the cap — and the disabled state has to explain
 * itself, because "No more photos" next to a library of nine hundred is a claim
 * that needs backing up.
 */

export function AddPhotoSlot({ busy, canOfferMore, kept, photosPerPost, onAdd, onRescan }: {
  busy: boolean;
  canOfferMore: boolean;
  kept: number;
  photosPerPost: number;
  onAdd: () => void;
  /** Null mid-split: a rescan there would throw away the remaining legs. */
  onRescan: (() => void) | null;
}): React.JSX.Element {
  if (busy) {
    return (
      <View style={[styles.card, styles.addCard]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.addLabel}>Finding one more…</Text>
        <Text style={styles.addHint}>The AI is looking through those days</Text>
      </View>
    );
  }

  if (canOfferMore) {
    return (
      <TouchableOpacity
        testID="review-add-photo"
        style={[styles.card, styles.addCard]}
        onPress={onAdd}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Add the next suggested photo"
      >
        <View style={styles.addPlus}>
          <Ionicons name="add" size={28} color={colors.accent} />
        </View>
        <Text style={styles.addLabel}>Add photo</Text>
        <Text style={styles.addHint}>
          {photosPerPost > 0 && kept < photosPerPost
            ? `${kept}/${photosPerPost} selected`
            : `${kept} selected · up to ${MAX_PHOTOS_PER_POST}`}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View
      testID="review-add-photo-disabled"
      style={[styles.card, styles.addCard, styles.addCardDisabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled: true }}
      accessibilityLabel="No more photos to add"
    >
      <View style={[styles.addPlus, styles.addPlusDisabled]}>
        <Ionicons name="add" size={28} color={colors.textMuted} />
      </View>
      <Text style={styles.addLabelDisabled}>No more photos</Text>
      {/* The reason lives in the header note, which is where the publisher
          already is when a round comes back empty — repeating it here just said
          the same thing twice. */}
      <Text style={styles.addHint}>Nothing else worth posting in those days</Text>
      {onRescan != null && (
        <TouchableOpacity onPress={onRescan} hitSlop={8}>
          <Text style={styles.addRescanLink}>Rescan library</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export const gridStyles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingBottom: 100,
  },
  moreSpinner: { width: '100%', alignItems: 'center', paddingVertical: spacing.md },
  capNote: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    width: '100%',
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});

const styles = StyleSheet.create({
  card: { width: '47%' },
  // Empty "add photo" slot shown while the post still has room.
  addCard: {
    aspectRatio: 1,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  addCardDisabled: { borderColor: colors.border },
  addPlus: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlusDisabled: { backgroundColor: colors.surface },
  addLabel: { ...typography.caption, fontSize: 12, fontWeight: '600', color: colors.accent },
  addLabelDisabled: { ...typography.caption, fontSize: 12, fontWeight: '600', color: colors.textMuted },
  addRescanLink: { ...typography.caption, fontSize: 11, color: colors.accent, textDecorationLine: 'underline' },
  addHint: { ...typography.caption, fontSize: 10, color: colors.textMuted, textAlign: 'center' },
});
