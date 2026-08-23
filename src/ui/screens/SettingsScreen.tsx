import React from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import type { RootNavigationProp } from '../navigation/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth, usePublisherId } from '../context/AuthContext';
import { usePhotoSyncSetting } from '../hooks/usePhotoSyncSetting';
import { confirmCloudPhotoWipe } from '../data/cloudPhotoWipe';
import { openLegalDocument, PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../legal';
import { colors, radius, spacing, typography } from '../theme/theme';

/**
 * App settings, opened from the Me-page gear. Currently: profile editing,
 * account info, the deleted-posts trash, the photo-sync switch, the cloud-photo
 * wipe, the hosted privacy policy and terms + sign out.
 */
export function SettingsScreen(): React.JSX.Element {
  const navigation = useNavigation<RootNavigationProp>();
  const { publisherPhone, signOut } = useAuth();
  const photoSync = usePhotoSyncSetting(usePublisherId());

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

        <Text style={styles.sectionLabel}>Privacy</Text>
        <View style={styles.card}>
          {/* The off-switch for photo upload, which is on by default. It lives
              here rather than in the auto-posting flow it powers: there it was
              a step in setting posting up, easy to hit by accident, and the
              only way to undo it was the cloud wipe — which deletes as well as
              stops. This one just stops. */}
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Ionicons name="cloud-upload-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Sync recent photos</Text>
              <Text style={styles.rowValue}>
                Uploads private copies of photos from your posting window, so posts
                can be prepared while the app is closed
              </Text>
            </View>
            <Switch
              testID="settings-photo-sync-toggle"
              value={photoSync.enabled === true}
              // Until storage has answered, the switch has nothing to show and
              // flipping it would write over a preference not yet read.
              disabled={photoSync.enabled == null}
              onValueChange={photoSync.setEnabled}
              trackColor={{ false: colors.border, true: colors.success }}
              thumbColor={colors.surface}
              ios_backgroundColor={colors.border}
            />
          </View>
          <View style={styles.divider} />
          <TouchableOpacity
            testID="settings-remove-cloud-photos"
            style={styles.row}
            // The wipe switches upload off too, so the toggle above has to be
            // told — it is the same state, shown twice on one screen.
            onPress={() => confirmCloudPhotoWipe(photoSync.refresh)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <Ionicons name="cloud-offline-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Remove my photos from the cloud</Text>
              <Text style={styles.rowValue}>
                Deletes the private copies used to prepare posts, and stops uploading new ones
              </Text>
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
          <View style={styles.divider} />
          <TouchableOpacity
            testID="settings-privacy-policy"
            style={styles.row}
            onPress={() => void openLegalDocument('Privacy Policy', PRIVACY_POLICY_URL)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Privacy Policy</Text>
              <Text style={styles.rowValue}>What we collect, and how to have it deleted</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            testID="settings-terms"
            style={styles.row}
            onPress={() => void openLegalDocument('Terms of Service', TERMS_OF_SERVICE_URL)}
            activeOpacity={0.7}
          >
            <View style={styles.iconWrap}>
              <Ionicons name="document-text-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Terms of Service</Text>
              <Text style={styles.rowValue}>The rules for sharing through the app</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </TouchableOpacity>
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
