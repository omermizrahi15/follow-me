import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PhotoClassification } from '../../domain/entities/PhotoClassification';
import { colors, radius, spacing, typography } from '../theme/theme';

interface Props {
  photo: PhotoClassification;
  /** Swap this photo for another from the pool; null when there is none left. */
  onSwap: (() => void) | null;
  /** Grid width. Two-up in review, three-up in the tighter history preview. */
  width?: '47%' | '31%';
}

/**
 * One suggested photo, carrying the single action available on it: swap this
 * photo for a different one. Shared by the live review screen and the history
 * preview so a suggestion looks and behaves the same wherever it appears.
 *
 * The chip deliberately does NOT name the AI's category. It is a button, not a
 * label, and captioning it "People" or "Nature" made the one thing you can do
 * to a photo read as decoration that happened to be tappable. It says what it
 * does, and keeps its icon whenever it is usable.
 */
export function SuggestionPhotoCard({ photo, onSwap, width = '47%' }: Props): React.JSX.Element {
  const swappable = onSwap != null;
  return (
    <View style={[styles.card, { width }]}>
      {/* Positioned against the IMAGE, not the card: anchoring to the card
          meant offsetting by a magic number that only held at one card size. */}
      <View style={styles.imageWrap}>
        <Image source={{ uri: photo.candidate.uri }} style={styles.photo} />
        <TouchableOpacity
          style={[styles.chip, !swappable && styles.chipDisabled]}
          onPress={onSwap ?? undefined}
          disabled={!swappable}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ disabled: !swappable }}
          accessibilityLabel="Show a different photo"
          hitSlop={4}
        >
          <Text style={styles.chipText} numberOfLines={1}>Other</Text>
          <Ionicons name="refresh" size={10} color={colors.ink} style={styles.chipIcon} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {},
  imageWrap: { width: '100%' },
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  chip: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    maxWidth: '88%',
    backgroundColor: colors.frosted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Dimmed rather than hidden: the control belongs to every photo, and chrome
  // that vanishes is more confusing than one that reads "not yet".
  chipDisabled: { opacity: 0.45 },
  chipText: { ...typography.caption, fontSize: 11, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  chipIcon: { marginLeft: 3 },
});
