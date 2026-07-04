import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Dimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native';
import type { RootNavigationProp, RootStackParamList } from '../navigation/types';
import { SectionNav, type HomeSection } from '../navigation/SectionNav';
import { logoSource } from '../assets';
import { PhotoFeed } from '../components/PhotoFeed';
import { AutoPostingSection } from './sections/AutoPostingSection';
import { FollowersSection } from './sections/FollowersSection';
import { useInviteLink } from '../hooks/useInviteLink';
import { useFeed } from '../hooks/useFeed';
import { useProfile } from '../hooks/useProfile';
import { useSubscribers } from '../hooks/useSubscribers';
import { usePublisherId } from '../context/AuthContext';
import { colors, radius, spacing, shadow, typography } from '../theme/theme';

const SCREEN_H = Dimensions.get('window').height;
/** Drag snap anchors: a small peek, a medium default (the Me-page height), and near-full. */
const SMALL_H = Math.round(SCREEN_H * 0.2);
const MEDIUM_H = Math.round(SCREEN_H * 0.42);
const FULL_H = Math.round(SCREEN_H * 0.84);
const SNAPS = [SMALL_H, MEDIUM_H, FULL_H];
/** Height of the floating nav bar — the sheet's lowest band stays glassy so the nav reads as glass. */
const NAV_BAR_H = 56;

/**
 * The "Me" page. The photo feed scrolls behind as the immersive background; a
 * draggable bottom sheet sits over it whose content switches between Me /
 * Auto-posting / Followers via the floating segmented nav (the feed and header
 * never change — only the sheet does). Drag the handle to resize the sheet.
 */
export function HomeScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'Home'>>();
  const requestedSection = route.params?.section;
  const { shareInvite } = useInviteLink();
  const publisherId = usePublisherId();
  const { profile } = useProfile(publisherId);
  const { subscribers, loading: followersLoading, reload: reloadSubscribers } = useSubscribers(publisherId);
  const { postings, loading: feedLoading, reload: reloadFeed } = useFeed(publisherId);
  const [section, setSection] = useState<HomeSection>('me');
  const [bioExpanded, setBioExpanded] = useState(false);

  // Real profile when set up; gracefully fall back when name/photo/bio are missing.
  const displayName = profile?.displayName ?? 'Your name';
  const bio = profile?.bio ?? null;
  const avatarUrl = profile?.avatarUrl ?? null;
  const bioIsLong = (bio?.length ?? 0) > 70;

  const heightAnim = useRef(new Animated.Value(MEDIUM_H)).current;
  const heightRef = useRef(MEDIUM_H);
  const startRef = useRef(MEDIUM_H);

  useEffect(() => {
    const id = heightAnim.addListener(({ value }) => { heightRef.current = value; });
    return () => heightAnim.removeListener(id);
  }, [heightAnim]);

  // Honour a deep-linked section (e.g. "Manage followers" from the post-share prompt).
  useEffect(() => {
    if (requestedSection != null) setSection(requestedSection);
  }, [requestedSection]);

  // The Me page never unmounts (sections are local state, Upload is a modal on
  // top), so refresh the followers count and the feed whenever the screen
  // regains focus — e.g. a fresh upload from the Upload modal must show up.
  useFocusEffect(
    useCallback(() => {
      void reloadSubscribers();
      void reloadFeed();
    }, [reloadSubscribers, reloadFeed]),
  );

  function snapTo(h: number): void {
    Animated.spring(heightAnim, { toValue: h, useNativeDriver: false, bounciness: 2, speed: 14 }).start();
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 2,
      onPanResponderGrant: () => { startRef.current = heightRef.current; },
      onPanResponderMove: (_, g) => {
        const next = Math.min(FULL_H, Math.max(SMALL_H, startRef.current - g.dy));
        heightAnim.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const cur = heightRef.current;
        let target: number;
        if (g.vy < -0.5) target = SNAPS.find(s => s > cur + 4) ?? FULL_H;
        else if (g.vy > 0.5) target = [...SNAPS].reverse().find(s => s < cur - 4) ?? SMALL_H;
        else target = SNAPS.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
        Animated.spring(heightAnim, { toValue: target, useNativeDriver: false, bounciness: 2, speed: 14 }).start();
      },
    }),
  ).current;

  function selectSection(next: HomeSection): void {
    setSection(next);
    // Returning to the Me page: refresh the followers count (e.g. after adding
    // or removing followers in the Followers section).
    if (next === 'me') void reloadSubscribers();
    // Open every section at the medium anchor; the user can drag to full for long content.
    snapTo(MEDIUM_H);
  }

  // The sheet stays docked to the bottom; its lowest band (behind the nav) is left
  // glassy (no white wash) so the nav reads as glass while content stays clean white.
  const glassBand = insets.bottom + NAV_BAR_H;
  const bottomInset = glassBand + spacing.md;

  return (
    <View style={styles.container}>
      {/* Feed = full-screen scrolling background */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: MEDIUM_H + spacing.lg }}
      >
        {postings.length > 0 ? (
          <>
            <PhotoFeed
              postings={postings}
              onPressPosting={p => navigation.navigate('Posting', { posting: p })}
            />
            <TouchableOpacity
              style={styles.feedEndButton}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Upload')}
            >
              <Ionicons name="add" size={18} color={colors.ink} />
              <Text style={styles.feedEndButtonText}>Add post</Text>
            </TouchableOpacity>
          </>
        ) : (
          !feedLoading && (
            <View style={styles.emptyFeed}>
              <Ionicons name="images-outline" size={44} color="rgba(255,255,255,0.4)" />
              <Text style={styles.emptyTitle}>No posts yet</Text>
              <Text style={styles.emptyHint}>Photos you share with “Add post” will show up here.</Text>
              <TouchableOpacity
                style={[styles.feedEndButton, { marginTop: spacing.md }]}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Upload')}
              >
                <Ionicons name="add" size={18} color={colors.ink} />
                <Text style={styles.feedEndButtonText}>Add post</Text>
              </TouchableOpacity>
            </View>
          )
        )}
      </ScrollView>

      {/* Top scrim + floating logo/gear */}
      <LinearGradient
        colors={['rgba(8,12,18,0.55)', 'transparent']}
        style={[styles.topScrim, { height: insets.top + 64 }]}
        pointerEvents="none"
      />
      <View style={[styles.appHeader, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.logoRow}>
          <Image source={logoSource} style={styles.logoImg} resizeMode="contain" />
          <Text style={styles.logoText}>Follow Me</Text>
        </View>
        <TouchableOpacity
          style={styles.gearButton}
          accessibilityLabel="Settings"
          onPress={() => navigation.navigate('Settings')}
        >
          <Ionicons name="settings-sharp" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Draggable sheet — solid white all the way down */}
      <Animated.View style={[styles.sheet, { height: heightAnim }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>
        <View style={styles.sheetBody}>
          {section === 'me' && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.meContent, { paddingBottom: bottomInset }]}
            >
              <View style={styles.profile}>
                <View style={styles.avatar}>
                  {avatarUrl != null ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                  ) : (
                    <Ionicons name="camera" size={26} color={colors.accent} />
                  )}
                </View>
                <View style={styles.profileText}>
                  <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
                  {bio != null && (
                    <Text style={styles.bio} numberOfLines={bioExpanded ? undefined : 2}>
                      {bio}
                    </Text>
                  )}
                  {bio != null && bioIsLong && (
                    <TouchableOpacity
                      style={styles.seeMore}
                      onPress={() => setBioExpanded(v => !v)}
                      hitSlop={6}
                    >
                      <Text style={styles.seeMoreText}>{bioExpanded ? 'See less' : 'See more'}</Text>
                      <Ionicons
                        name={bioExpanded ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={colors.accent}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.stats}>
                <View style={styles.statCol}>
                  <Text style={styles.statNumber}>{followersLoading ? '—' : subscribers.length}</Text>
                  <Text style={styles.statLabel}>
                    {subscribers.length === 1 ? 'Follower' : 'Followers'}
                  </Text>
                </View>
              </View>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.addButton}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('Upload')}
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.addButtonText}>Add post</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.inviteButton} activeOpacity={0.85} onPress={shareInvite}>
                  <Ionicons name="person-add-outline" size={15} color={colors.ink} />
                  <Text style={styles.inviteButtonText}>Invite</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
          {section === 'auto' && (
            <AutoPostingSection bottomInset={bottomInset} onSaved={() => selectSection('me')} />
          )}
          {section === 'followers' && <FollowersSection bottomInset={bottomInset} />}
        </View>
      </Animated.View>

      {/* Floating segmented nav (changes the sheet content only) */}
      <View style={[styles.navWrap, { bottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
        <SectionNav active={section} onChange={selectSection} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E141C' },
  emptyFeed: {
    height: SCREEN_H - MEDIUM_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
  },
  emptyTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  emptyHint: { color: 'rgba(255,255,255,0.65)', fontSize: 13, textAlign: 'center' },
  feedEndButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#fff',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    marginVertical: spacing.xl,
  },
  feedEndButtonText: { color: colors.ink, fontWeight: '600', fontSize: 14 },
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
  logoImg: { width: 40, height: 30, tintColor: '#fff' },
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
    overflow: 'hidden',
    ...shadow.raised,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm },
  handle: { width: 40, height: 5, borderRadius: radius.pill, backgroundColor: colors.border },
  sheetBody: { flex: 1 },
  meContent: { paddingHorizontal: spacing.xl },
  profile: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
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
  bio: { ...typography.caption, fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
  seeMore: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 3 },
  seeMoreText: { ...typography.caption, fontSize: 12, fontWeight: '600', color: colors.accent },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.lg },
  statCol: { flex: 1 },
  statNumber: { ...typography.heading, fontSize: 19, color: colors.text },
  statLabel: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
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
  navWrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
});
