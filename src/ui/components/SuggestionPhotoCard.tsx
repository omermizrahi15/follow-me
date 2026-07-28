import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import { CATEGORY_LABEL } from '../data/categoryLabels';
import { colors, radius, spacing, typography } from '../theme/theme';

interface Props {
  photo: PhotoClassification;
  /**
   * Swap this photo for another from the pool. Null when there is nothing to
   * swap to — the chip then renders as a plain label, with no refresh icon, so
   * it never looks tappable when it isn't.
   */
  onSwap: (() => void) | null;
  /** Grid width. Two-up in review, three-up in the tighter history preview. */
  width?: '47%' | '31%';
}

/**
 * One suggested photo: the image, the AI's category as a frosted chip, and its
 * caption. Shared by the live review screen and the history preview so a
 * suggestion looks and behaves the same wherever it is shown — they had drifted
 * into two different-looking cards, one of which only pretended to be tappable.
 */
export function SuggestionPhotoCard({ photo, onSwap, width = '47%' }: Props): React.JSX.Element {
  return (
    <View style={[styles.card, { width }]}>
      <Image source={{ uri: photo.candidate.uri }} style={styles.photo} />
      <TouchableOpacity
        style={styles.chip}
        onPress={onSwap ?? undefined}
        disabled={onSwap == null}
        activeOpacity={onSwap != null ? 0.7 : 1}
        accessibilityRole={onSwap != null ? 'button' : 'text'}
        accessibilityLabel={
          onSwap != null
            ? `${CATEGORY_LABEL[photo.category]}. Suggest a different photo`
            : CATEGORY_LABEL[photo.category]
        }
        hitSlop={4}
      >
        <Text style={styles.chipText}>{CATEGORY_LABEL[photo.category]}</Text>
        {onSwap != null && (
          <Ionicons name="refresh" size={10} color={colors.ink} style={styles.chipIcon} />
        )}
      </TouchableOpacity>
      {photo.caption !== '' && (
        <Text style={styles.caption} numberOfLines={1}>{photo.caption}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {},
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  chip: {
    position: 'absolute',
    bottom: spacing.lg + 18,
    left: spacing.sm,
    backgroundColor: colors.frosted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipText: { ...typography.caption, fontSize: 11, fontWeight: '600', color: colors.ink },
  chipIcon: { marginLeft: 3 },
  caption: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs },
});
