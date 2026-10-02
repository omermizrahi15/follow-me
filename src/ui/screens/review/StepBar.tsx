import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing, typography } from '../../theme/theme';
import { suggestionSteps } from '../../../domain/services/suggestionProgress';
import type { SuggestionStepsInput } from '../../../domain/services/suggestionProgress';

/**
 * Scanning → Duplicates → Grading → Preview, with a bar under the stage that
 * has one.
 *
 * Which stage is where is decided in the domain (`suggestionProgress`), not
 * here — this used to read the run's `phase` alone, and `phase` turns `done`
 * as soon as there are enough grades to render a post. The bar therefore
 * ticked "Classifying" green while the AI was still working through the rest
 * of the window, which is what made grading look like a step the app skipped.
 */
export function StepBar(props: SuggestionStepsInput): React.JSX.Element {
  const steps = suggestionSteps(props);
  const grading = steps.find(s => s.key === 'grade');
  const showBar = grading?.state === 'active' && grading.progress != null;
  const pct = Math.round((grading?.progress ?? 0) * 100);
  // How far along the rail the run has got: full segments between dots, so
  // three of four stages done fills two thirds of it.
  const reached = steps.filter(s => s.state !== 'pending').length;
  const railFill = Math.max(0, Math.min(100, ((reached - 1) / (steps.length - 1)) * 100));

  return (
    <View>
      <View style={styles.container}>
        {/* One connector behind the dots rather than one between each pair:
            four equal columns put every dot at its column's centre, so a single
            line inset by half a column joins all of them and the labels below
            can be any width without pushing the dots out of alignment. */}
        <View style={styles.rail} pointerEvents="none">
          <View style={[styles.railFill, { width: `${railFill}%` }]} />
        </View>
        {steps.map((step, i) => (
          <View key={step.key} style={styles.step}>
            <View
              style={[
                styles.dot,
                step.state === 'done' && styles.dotDone,
                step.state === 'active' && styles.dotActive,
              ]}
            >
              {step.state === 'done' ? (
                <Ionicons name="checkmark" size={10} color={colors.onAccent} />
              ) : (
                <Text style={styles.dotText}>{i + 1}</Text>
              )}
            </View>
            <Text
              style={[styles.label, step.state !== 'pending' && styles.labelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {step.label}
            </Text>
            {/* The count each stage measured — what turns a row of dots into an
                account of what the AI actually did. */}
            <Text style={styles.detail} numberOfLines={1}>
              {step.detail ?? ' '}
            </Text>
          </View>
        ))}
      </View>
      {showBar && (
        <View style={styles.barRow}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.pct}>{pct}%</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
  },
  /** Equal columns, so every dot sits on its column's centre line. */
  step: { flex: 1, alignItems: 'center', gap: 2 },
  rail: {
    position: 'absolute',
    // Half a column in from each edge: the centre of the first dot to the
    // centre of the last.
    left: '12.5%',
    right: '12.5%',
    top: spacing.sm + 9,
    height: 2,
    backgroundColor: colors.border,
  },
  railFill: { height: 2, backgroundColor: colors.success },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { backgroundColor: colors.accent },
  dotDone: { backgroundColor: colors.success },
  dotText: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  label: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  labelActive: { color: colors.text, fontWeight: '600' },
  // Always rendered, with a space when there is nothing to say, so a stage
  // learning its count does not shunt the whole bar down a line.
  detail: { ...typography.caption, fontSize: 9, color: colors.textMuted, textAlign: 'center' },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  pct: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
    width: 34,
    textAlign: 'right',
  },
});
