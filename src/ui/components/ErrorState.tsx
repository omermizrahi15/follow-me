import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { classifyFailure, describeFailure } from '../../domain/services/networkError';
import { useConnectionStatus } from '../data/connectivity';
import { colors, radius, spacing, typography } from '../theme/theme';

/**
 * What a screen shows when the thing it was loading did not arrive (issue #145).
 *
 * Every failure state in the app is this component, for two reasons. The copy
 * has to distinguish "you are offline" from "our server is broken" — they call
 * for completely different things from the user — and that logic belongs in one
 * tested place (`domain/services/networkError`) rather than re-derived per
 * screen. And every failure has to offer a way to try again: before this, a
 * failed load left either a bare red line or, worse, an empty state that said
 * "No posts yet" to someone whose posts had simply failed to load.
 */

interface Props {
  /** The caught error. Anything — it is classified, not trusted. */
  error: unknown;
  /** What failed, in the user's terms: "Couldn't load your posts". */
  title: string;
  onRetry: () => void;
  /** Whether a retry is already in flight, so the button can say so. */
  retrying?: boolean;
  /** Inline variant for a section of a screen rather than the whole of it. */
  compact?: boolean;
  /** Invert the text for the one screen that is black edge to edge (the story viewer). */
  onDark?: boolean;
}

export function ErrorState({
  error,
  title,
  onRetry,
  retrying = false,
  compact = false,
  onDark = false,
}: Props): React.JSX.Element {
  const connection = useConnectionStatus();
  const copy = describeFailure({ error, connection, title });
  // A connection problem is not a fault the user should feel accused of, so it
  // gets the neutral cloud rather than the alert triangle.
  const connectionProblem =
    connection !== 'online' || ['offline', 'timeout'].includes(classifyFailure(error));

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]} testID="error-state">
      <Ionicons
        name={connectionProblem ? 'cloud-offline-outline' : 'alert-circle-outline'}
        size={compact ? 22 : 30}
        color={onDark ? 'rgba(255,255,255,0.6)' : colors.textMuted}
      />
      <Text style={[styles.title, onDark && styles.titleOnDark]} testID="error-state-title">
        {copy.title}
      </Text>
      <Text style={[styles.hint, onDark && styles.hintOnDark]}>{copy.hint}</Text>
      <TouchableOpacity
        testID="error-state-retry"
        style={[styles.button, retrying && styles.buttonBusy]}
        onPress={onRetry}
        disabled={retrying}
        activeOpacity={0.85}
      >
        <Ionicons name="refresh" size={14} color={colors.onAccent} />
        <Text style={styles.buttonText}>{retrying ? 'Trying…' : copy.action}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  wrapCompact: { paddingVertical: spacing.lg },
  title: { ...typography.heading, color: colors.text, textAlign: 'center' },
  titleOnDark: { color: '#FFFFFF' },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  hintOnDark: { color: 'rgba(255,255,255,0.75)' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { ...typography.button, fontSize: 13, color: colors.onAccent },
});
