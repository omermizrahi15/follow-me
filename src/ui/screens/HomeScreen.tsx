import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
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
import { CompactFeedCard, CARD_HEIGHT } from '../components/CompactFeed';
import { RouteGlobe } from '../map/RouteGlobe';
import { AutoPostingSection } from './sections/AutoPostingSection';
import { ReviewSuggestionContent } from './ReviewSuggestionScreen';
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
  const { profile, reload: reloadProfile } = useProfile(publisherId);
  const { subscribers, loading: followersLoading, reload: reloadSubscribers } = useSubscribers(publisherId);
  const { postings, loading: feedLoading, reload: reloadFeed } = useFeed(publisherId);
  const [section, setSection] = useState<HomeSection>('me');
  const [bioExpanded, setBioExpanded] = useState(false);
  const [showingSuggestions, setShowingSuggestions] = useState(false);
  const [suggestionKey, setSuggestionKey] = useState(0);

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
  // top), so refresh the followers count, the feed and the profile whenever
  // the screen regains focus — e.g. a fresh upload or a profile edit in
  // Settings must show up on return.
  useFocusEffect(
    useCallback(() => {
      void reloadSubscribers();
      void reloadFeed();
      void reloadProfile();
    }, [reloadSubscribers, reloadFeed, reloadProfile]),
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
    setShowingSuggestions(false);
    setSection(next);
    if (next === 'me') void reloadSubscribers();
    snapTo(MEDIUM_H);
  }

  function handlePreview(): void {
    setSuggestionKey(k => k + 1);
    setShowingSuggestions(true);
    snapTo(FULL_H);
  }

  function closeSuggestions(): void {
    setShowingSuggestions(false);
    snapTo(MEDIUM_H);
    // The sheet lives inside Home (no focus change), so refresh the feed
    // explicitly — the user may have just posted from it.
    void reloadFeed();
  }

  // The sheet stays docked to the bottom; its lowest band (behind the nav) is left
  // glassy (no white wash) so the nav reads as glass while content stays clean white.
  const glassBand = insets.bottom + NAV_BAR_H;
  const bottomInset = glassBand + spacing.md;

  // The header always floats over the dark globe now, so it is always white.
  const headerTint = '#fff';

  return (
    <View style={styles.container}>
      {/* The travel map is the background: every posting pinned where it was
          taken, joined in chronological order. The feed itself now lives in
          the Me sheet below. */}
      <RouteGlobe
        postings={postings}
        onPressPosting={p => navigation.navigate('Posting', { posting: p })}
        bottomPadding={MEDIUM_H}
      />

      {/* Top scrim (only over photos) + floating logo/gear */}
      <LinearGradient
        colors={['rgba(8,12,18,0.55)', 'transparent']}
        style={[styles.topScrim, { height: insets.top + 64 }]}
        pointerEvents="none"
      />
      <View style={[styles.appHeader, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.logoRow}>
          <Image source={logoSource} style={[styles.logoImg, { tintColor: headerTint }]} resizeMode="contain" />
          <Text style={[styles.logoText, { color: headerTint }]}>Follow Me</Text>
        </View>
        <TouchableOpacity
          testID="home-settings-button"
          style={styles.gearButton}
          accessibilityLabel="Settings"
          onPress={() => navigation.navigate('Settings')}
        >
          <Ionicons name="settings-sharp" size={20} color={headerTint} />
        </TouchableOpacity>
      </View>

      {/* Draggable sheet — solid white all the way down */}
      <Animated.View style={[styles.sheet, { height: heightAnim }]}>
        <View testID="home-sheet-handle" style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>
        <View style={styles.sheetBody}>
          {showingSuggestions && (
            <ReviewSuggestionContent
              key={suggestionKey}
              onBack={closeSuggestions}
              bottomInset={bottomInset}
            />
          )}
          {!showingSuggestions && section === 'me' && (
            <FlatList
              data={postings}
              keyExtractor={p => p.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.meContent, { paddingBottom: bottomInset }]}
              renderItem={({ item }) => (
                <CompactFeedCard
                  posting={item}
                  onPress={() => navigation.navigate('Posting', { posting: item })}
                />
              )}
              // Fixed-height cards, so the list can skip measuring and mount
              // only what is near the viewport however long the feed gets.
              getItemLayout={(_, index) => ({
                length: CARD_HEIGHT + spacing.md,
                offset: (CARD_HEIGHT + spacing.md) * index,
                index,
              })}
              initialNumToRender={4}
              windowSize={5}
              removeClippedSubviews
              ListEmptyComponent={
                feedLoading ? null : (
                  <View style={styles.emptyFeed}>
                    <Ionicons name="images-outline" size={32} color={colors.textMuted} />
                    <Text style={styles.emptyTitle}>No posts yet</Text>
                    <Text style={styles.emptyHint}>
                      Photos you share with “Add post” show up here and on the map.
                    </Text>
                  </View>
                )
              }
              ListHeaderComponent={
                <>
                  <View style={styles.profile}>
                    <View style={styles.avatar}>
                      {avatarUrl != null ? (
                        <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                      ) : (
                        <Ionicons name="camera" size={26} color={colors.accent} />
                      )}
                    </View>
                    <View style={styles.profileText}>
                      <Text testID="home-profile-name" style={styles.name} numberOfLines={1}>{displayName}</Text>
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
                      testID="home-add-post"
                      style={styles.addButton}
                      activeOpacity={0.85}
                      onPress={() => navigation.navigate('Upload')}
                    >
                      <Ionicons name="add" size={16} color="#fff" />
                      <Text style={styles.addButtonText}>Add post</Text>
                    </TouchableOpacity>
                    <TouchableOpacity testID="home-invite" style={styles.inviteButton} activeOpacity={0.85} onPress={shareInvite}>
                      <Ionicons name="person-add-outline" size={15} color={colors.ink} />
                      <Text style={styles.inviteButtonText}>Invite</Text>
                    </TouchableOpacity>
                  </View>

                  {postings.length > 0 && <Text style={styles.feedHeading}>Posts</Text>}
                </>
              }
            />
          )}
          {!showingSuggestions && section === 'auto' && (
            <AutoPostingSection
              bottomInset={bottomInset}
              onSaved={() => selectSection('me')}
              onPreview={handlePreview}
            />
          )}
          {!showingSuggestions && section === 'followers' && <FollowersSection bottomInset={bottomInset} />}
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
  container: { flex: 1, backgroundColor: colors.background },
  emptyFeed: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  emptyHint: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  feedHeading: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
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
  logoImg: { width: 40, height: 30 },
  logoText: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
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
