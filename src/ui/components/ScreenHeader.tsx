import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography } from '../theme/theme';

/**
 * Lightweight header for pages with headerShown: false. Shows a back chevron
 * for pushed stack pages; pass showBack={false} for tab screens (title only).
 */
export function ScreenHeader({ title, showBack = true }: { title: string; showBack?: boolean }): React.JSX.Element {
  const navigation = useNavigation();
  return (
    <View style={styles.header}>
      {showBack && (
        <TouchableOpacity
          testID="header-back"
          onPress={() => navigation.goBack()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
      )}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, fontSize: 20, color: colors.text },
});
