import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing, typography } from '../../theme/theme';

/** The end of the flow: the post went out, and there is nothing left to review. */
export function PostedConfirmation({ photoCount, onDone }: {
  photoCount: number;
  onDone: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.centered}>
      <View style={styles.badge}>
        <Ionicons name="checkmark" size={40} color={colors.onAccent} />
      </View>
      <Text style={styles.title}>Posted!</Text>
      <Text style={styles.subtitle}>
        {photoCount} photo{photoCount === 1 ? '' : 's'} sent to your followers.
      </Text>
      <TouchableOpacity style={styles.button} onPress={onDone}>
        <Text style={styles.buttonText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  badge: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.title, fontSize: 28, color: colors.text },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },
  button: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: { color: colors.text, fontWeight: '600' },
});
