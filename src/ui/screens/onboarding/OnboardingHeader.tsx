import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { logoSource } from '../../assets';
import { colors, radius, spacing } from '../../theme/theme';

type Props = {
  /** 1-based index of the current step. */
  current: number;
  /** Total number of steps. */
  total: number;
};

/** Brand row + step-progress dots, shared across onboarding steps. */
export function OnboardingHeader({ current, total }: Props): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      <View style={styles.brand}>
        <Image source={logoSource} style={styles.brandLogo} resizeMode="contain" />
        <Text style={styles.brandText}>Follow Me</Text>
      </View>
      <View style={styles.dots}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[styles.dot, i + 1 === current && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  brandLogo: { width: 44, height: 33 },
  brandText: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  dots: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xxl },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent, width: 22 },
});
