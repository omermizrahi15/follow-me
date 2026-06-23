import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { TabNavigationProp, RootNavigationProp } from '../navigation/types';
import { PhotoFeed } from '../components/PhotoFeed';
import { feedStubs } from '../data/feedStubs';
import { profileStub } from '../data/profileStub';
import { usePublisherId } from '../context/AuthContext';
import { colors, radius, spacing, shadow, typography } from '../theme/theme';

/** Vertical footprint reserved for the floating nav (pill). */
const NAV_SPACE = 64;
// Public subscribe page (GitHub Pages); publisher id travels as the `?p=` param.
const JOIN_BASE_URL = 'https://omermizrahi15.github.io/follow-me/join/';

/**
 * The "Me" page — Polarsteps-style. The full-bleed photo feed scrolls behind
 * everything as the immersive background (where Polarsteps shows the globe). A
 * full-width white sheet is docked to the bottom holding the profile, the
 * Countries/Followers stats and the Add post / Invite actions; the app logo +
 * settings gear float on top and the nav floats over the sheet.
 */
export function HomeScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<TabNavigationProp>();
  const rootNavigation = navigation.getParent<RootNavigationProp>();
  const publisherId = usePublisherId();
  const [sheetHeight, setSheetHeight] = useState(280);

  function handleInvite(): void {
    const joinLink = `${JOIN_BASE_URL}?p=${publisherId}`;
    // message only (no `url`) so WhatsApp gets plain text, not a bplist.
    void Share.share({
      message: `Follow me on Follow Me! You'll receive my photos on WhatsApp: ${joinLink}`,
    });
  }

  return (
    <View style={styles.container}>
      {/* Feed = full-screen scrolling background */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: sheetHeight + spacing.lg }}
      >
        <PhotoFeed postings={feedStubs} />
      </ScrollView>

      {/* Top scrim keeps the white logo + gear legible over the photos */}
      <LinearGradient
        colors={['rgba(8,12,18,0.55)', 'transparent']}
        style={[styles.topScrim, { height: insets.top + 64 }]}
        pointerEvents="none"
      />
      <View style={[styles.appHeader, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.logoRow}>
          <View style={styles.logoMark}>
            <Ionicons name="navigate" size={16} color={colors.ink} />
          </View>
          <Text style={styles.logoText}>Follow Me</Text>
        </View>
        <TouchableOpacity
          style={styles.gearButton}
          accessibilityLabel="Settings"
          onPress={() => rootNavigation.navigate('Settings')}
        >
          <Ionicons name="settings-sharp" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Full-width profile sheet docked to the bottom */}
      <View
        style={[styles.sheet, { paddingBottom: insets.bottom + NAV_SPACE + spacing.md }]}
        onLayout={e => setSheetHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.handle} />

        <View style={styles.profile}>
          <View style={styles.avatar}>
            {profileStub.avatarUri ? (
              <Image source={{ uri: profileStub.avatarUri }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="camera" size={28} color={colors.accent} />
            )}
          </View>
          <View style={styles.profileText}>
            <Text style={styles.name} numberOfLines={1}>{profileStub.name}</Text>
            <View style={styles.bioRow}>
              <Text style={styles.bio} numberOfLines={2}>{profileStub.bio}</Text>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </View>
          </View>
        </View>

        <View style={styles.stats}>
          <View style={styles.statCol}>
            <Text style={styles.statNumber}>{profileStub.countries}</Text>
            <Text style={styles.statLabel}>Countries</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statNumber}>{profileStub.followers}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.addButton}
            activeOpacity={0.85}
            onPress={() => rootNavigation.navigate('Upload')}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addButtonText}>Add post</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.inviteButton} activeOpacity={0.85} onPress={handleInvite}>
            <Ionicons name="person-add-outline" size={15} color={colors.ink} />
            <Text style={styles.inviteButtonText}>Invite</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E141C' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  appHeader: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logoMark: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  gearButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    ...shadow.raised,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  profileText: { flex: 1 },
  name: { ...typography.heading, fontSize: 17, color: colors.text, marginBottom: 1 },
  bioRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  bio: { ...typography.caption, fontSize: 12, color: colors.textSecondary, lineHeight: 16, flex: 1 },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  statCol: { flex: 1 },
  statNumber: { ...typography.heading, fontSize: 19, color: colors.text },
  statLabel: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginHorizontal: spacing.lg },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  addButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.ink,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  inviteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  inviteButtonText: { color: colors.ink, fontWeight: '600', fontSize: 12 },
});
