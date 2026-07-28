import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { RootNavigationProp } from '../navigation/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing, typography } from '../theme/theme';

/**
 * App settings, opened from the Me-page gear. Currently: profile editing,
 * account info, the deleted-posts trash + sign out. Fuller content (about,
 * privacy, terms) in issue #35.
 */
export function SettingsScreen(): React.JSX.Element {
  const navigation = useNavigation<RootNavigationProp>();
  const { publisherPhone, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <TouchableOpacity
            testID="settings-edit-profile"
            style={styles.row}
            onPress={() => navigation.navigate('EditProfile')}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <Ionicons name="person-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Edit profile</Text>
              <Text style={styles.rowValue}>Name and photo</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Ionicons name="call-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Phone number</Text>
              <Text style={styles.rowValue}>{publisherPhone ?? 'Not available'}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Posts</Text>
        <View style={styles.card}>
          <TouchableOpacity
            testID="settings-trash"
            style={styles.row}
            onPress={() => navigation.navigate('Trash')}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <Ionicons name="trash-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Deleted posts</Text>
              <Text style={styles.rowValue}>Restore a post you removed</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Follow Me</Text>
              <Text style={styles.rowValue}>Version 0.1.0</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity testID="settings-sign-out" style={styles.signOutButton} onPress={() => void signOut()}>
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.text },
  rowValue: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    marginTop: spacing.xxl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  signOutText: { color: colors.danger, fontWeight: '600', fontSize: 15 },
});
