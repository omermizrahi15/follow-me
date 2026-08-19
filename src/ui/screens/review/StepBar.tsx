import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, spacing } from '../../theme/theme';

/** Scanning → Classifying → Done, with a progress bar during classification. */

const STEPS = ['Scanning', 'Classifying', 'Done'] as const;

function stepIndex(phase: string): number {
  if (phase === 'scanning') return 0;
  if (phase === 'classifying') return 1;
  return 2;
}

export function StepBar({ phase, classified, total }: {
  phase: string; classified: number; total: number;
}): React.JSX.Element {
  const current = stepIndex(phase);
  const pct = total > 0 ? Math.round((classified / total) * 100) : 0;

  return (
    <View>
      <View style={styles.container}>
        {STEPS.map((label, i) => {
          const active = i === current;
          const done = i < current || phase === 'done';
          return (
            <React.Fragment key={label}>
              {i > 0 && <View style={[styles.line, done && styles.lineDone]} />}
              <View style={[styles.dot, done && styles.dotDone, active && styles.dotActive]}>
                {done && !active ? (
                  <Ionicons name="checkmark" size={10} color={colors.onAccent} />
                ) : (
                  <Text style={styles.dotText}>{i + 1}</Text>
                )}
              </View>
              <Text style={[styles.label, (active || done) && styles.labelActive]}>{label}</Text>
            </React.Fragment>
          );
        })}
      </View>
      {phase === 'classifying' && total > 0 && (
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
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: 4,
  },
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
  line: { flex: 1, height: 2, backgroundColor: colors.border },
  lineDone: { backgroundColor: colors.success },
  label: { fontSize: 11, color: colors.textSecondary, minWidth: 50 },
  labelActive: { color: colors.text, fontWeight: '600' },
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
