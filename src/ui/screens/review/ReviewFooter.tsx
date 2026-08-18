import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { PlaceField } from '../../components/PlaceField';
import type { Coordinate } from '../../../domain/interfaces';
import type { PlaceResolution } from '../../hooks/usePlaceResolution';
import { colors, radius, spacing, typography } from '../../theme/theme';

/**
 * Place field + post button.
 *
 * The note under the field is the whole point of separating "no place yet" from
 * "still looking": an empty field used to mean both, and issue #63 was mostly
 * people not knowing which one they were looking at.
 */

interface Props {
  place: PlaceResolution;
  keptCount: number;
  sharing: boolean;
  shareError: string | null;
  shareProgress: { stage: string; done: number; total: number } | null;
  /** Padding that keeps the input above the keyboard — see useKeyboardBottomPadding. */
  keyboardPadding: number;
  onConfirm: () => void;
}

const SOURCE_NOTE: Record<string, string> = {
  photos: "Place from the selected photos' GPS",
  scan: 'Place from other photos taken around the same time',
  none: 'No place found — the photos carry no GPS. Type one to include it.',
};

export function ReviewFooter({
  place, keptCount, sharing, shareError, shareProgress, keyboardPadding, onConfirm,
}: Props): React.JSX.Element {
  return (
    <View style={[styles.footer, keyboardPadding > 0 && { paddingBottom: keyboardPadding }]}>
      {shareError != null && <Text style={styles.errorNote}>{shareError}</Text>}
      <PlaceField
        value={place.place}
        loading={place.loading}
        hasGps={place.gpsCoordinate != null}
        onChange={(label: string, coordinate?: Coordinate) => place.setPicked(label, coordinate)}
      />
      {place.source != null && (
        <Text style={[styles.placeSourceNote, place.source === 'none' && styles.placeSourceWarn]}>
          {SOURCE_NOTE[place.source]}
        </Text>
      )}
      <TouchableOpacity
        style={[styles.confirmButton, sharing && styles.disabled]}
        onPress={onConfirm}
        disabled={sharing || !place.canPost}
        activeOpacity={0.85}
      >
        {sharing ? (
          <View style={styles.progressRow}>
            <ActivityIndicator color={colors.onAccent} />
            <Text style={styles.confirmText}>
              {shareProgress == null
                ? 'Posting…'
                : shareProgress.stage === 'uploading'
                ? `Uploading ${Math.min(shareProgress.done + 1, shareProgress.total)}/${shareProgress.total}…`
                : 'Sending to followers…'}
            </Text>
          </View>
        ) : (
          <Text style={styles.confirmText}>
            Post {keptCount} photo{keptCount === 1 ? '' : 's'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingVertical: spacing.md },
  placeSourceNote: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: -2,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  placeSourceWarn: { color: '#C87A00' },
  errorNote: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm },
  confirmButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  confirmText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
