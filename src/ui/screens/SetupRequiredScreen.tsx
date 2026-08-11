import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/theme';

/**
 * Shown instead of the navigator when required build-time configuration is
 * missing (issue #110).
 *
 * A fresh clone used to get a blank app and a thrown error naming one variable
 * — the next one only after signing up for that service and rebuilding. This
 * screen is the whole list, on the device, with the account each value comes
 * from, so the setup is one trip through .env rather than four.
 */
export function SetupRequiredScreen({ message }: { message: string }): React.JSX.Element {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Setup needed</Text>
        {/* Monospaced so the variable names and the URL stay readable and
            copyable exactly as they must be typed into .env. */}
        <Text style={styles.message} selectable>
          {message}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingTop: spacing.xxl * 2 },
  title: { ...typography.largeTitle, color: colors.text, marginBottom: spacing.lg },
  message: {
    ...typography.caption,
    fontFamily: 'Menlo',
    lineHeight: 20,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
});
