import React, { useEffect, useRef, useState } from 'react';
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
// The bundled logo stays on React Native's Image — it is already in the
// binary, so there is nothing to cache, and it is tinted per screen. Only the
// avatar comes off the network.
import { Image as RemoteImage } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { RootNavigationProp, RootStackParamList } from '../navigation/types';
import { SectionNav, SECTION_NAV_HEIGHT, type HomeSection } from '../navigation/SectionNav';
import { logoSource } from '../assets';
import { PostCard, POST_CARD_HEIGHT } from '../components/PostCard';
import { RouteGlobe } from '../map/RouteGlobe';
import { AutoPostingSection } from './sections/AutoPostingSection';
import { ReviewSuggestionContent } from './ReviewSuggestionScreen';
import { HistoryBackfillContent } from './HistoryBackfillScreen';
import { FollowersSection } from './sections/FollowersSection';
import { useInviteLink } from '../hooks/useInviteLink';
import { useFeed } from '../hooks/useFeed';
import { moveToTrash } from '../hooks/useTrash';
import { useProfile } from '../hooks/useProfile';
import { useHistoryGaps } from '../hooks/useHistoryGaps';
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
const NAV_BAR_H = SECTION_NAV_HEIGHT;

/**
 * The sheet is always FULL_H tall and slides down to shrink, instead of being
 * a short view whose `height` animates.
 *
 * Animating `height` is a layout property, which forces `useNativeDriver:
 * false`: every frame of the drag and every spring step round-trips through the
 * JS bridge, and `onPanResponderMove` pushed one per touch event on top of
 * that. With the WebView globe compositing behind it that is what dropped
 * frames. A `translateY` on a fixed-height view is a transform, so the whole
 * gesture runs on the UI thread and never touches JS — the same thing
 * PostingDetailScreen already does for its drag-to-dismiss.
 *
 * The cost is that the part hanging below the screen is real, laid-out sheet,
 * so the content inside has to be padded past it — see `bottomInset`.
 */
const SHEET_H = FULL_H;
/** How far the sheet is pushed down to show `visible` points of it. */
function offsetFor(visible: number): number {
  return SHEET_H - visible;
}

/** Keeps a drag between the smallest peek and the fully open sheet. */
function clampOffset(offset: number): number {
  return Math.min(offsetFor(SMALL_H), Math.max(offsetFor(FULL_H), offset));
}

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
  // Nonce from a reminder-notification tap — see RootStackParamList.Home.
  const suggestionRequest = route.params?.suggestionRequest;
  const { shareInvite } = useInviteLink();
  const publisherId = usePublisherId();
  // All three come from the shared cache (issue #114): one request per entity
  // however many components ask, served from memory on the way back, and kept
  // current by the writes that change them rather than by refetching here.
  const { profile } = useProfile(publisherId);
  const { subscribers, loading: followersLoading } = useSubscribers(publisherId);
  const { postings, loading: feedLoading } = useFeed(publisherId);
  // The History tab exists only when some stretch of the trip has no posting —
  // including a hole in the middle, not just a missing beginning (issue #81).
  const { hasGaps, gaps, tripStartDate } = useHistoryGaps(profile, postings);
  const [section, setSection] = useState<HomeSection>('me');
  const [showingSuggestions, setShowingSuggestions] = useState(false);
  // Which feed card has its Delete revealed — at most one, the way an iOS
  // list only ever keeps a single row open.
  const [swipedPostId, setSwipedPostId] = useState<string | null>(null);
  const [suggestionKey, setSuggestionKey] = useState(0);
  // "Add post" no longer goes straight to the picker — it asks which of the two
  // ways to build a post the publisher wants. Deliberately an in-screen overlay
  // rather than a React Native <Modal>: the manual branch pushes the Upload
  // *stack* modal, and presenting one iOS modal while another is dismissing is
  // exactly the sequence that drops the second presentation.
  const [choosingPostKind, setChoosingPostKind] = useState(false);
  const chooserAnim = useRef(new Animated.Value(0)).current;

  // Real profile when set up; gracefully fall back when name/photo are missing.
  const displayName = profile?.displayName ?? 'Your name';
  const avatarUrl = profile?.avatarUrl ?? null;

  // How far the sheet is pushed down. Driven natively, so JS never sees the
  // frames — hence the two plain refs below instead of an Animated listener,
  // which would put every frame back on the bridge and undo the point of it.
  const dragY = useRef(new Animated.Value(offsetFor(MEDIUM_H))).current;
  /** Where the sheet came to rest, i.e. where the next drag starts from. */
  const restOffsetRef = useRef(offsetFor(MEDIUM_H));
  /** Where this drag started. */
  const grabOffsetRef = useRef(offsetFor(MEDIUM_H));
  // Only the resting height is state: it feeds the content inset, and nothing
  // needs to re-render mid-drag.
  const [visibleH, setVisibleH] = useState(MEDIUM_H);

  // Honour a deep-linked section (e.g. "Manage followers" from the post-share prompt).
  useEffect(() => {
    if (requestedSection != null) setSection(requestedSection);
  }, [requestedSection]);

  // Tapping the reminder opens the suggested-post sheet. This is the only way
  // in from a notification now that the review screen has no modal route of its
  // own; the nonce is what makes a second tap reopen a sheet already closed.
  useEffect(() => {
    if (suggestionRequest == null) return;
    setSuggestionKey(k => k + 1);
    setShowingSuggestions(true);
    snapTo(FULL_H);
  }, [suggestionRequest]);

  // The focus-refresh that used to sit here is gone: the shared read cache
  // (#114) revalidates feed, profile and followers itself, so asking again on
  // every focus was two round trips and two feed states per focus.

  function snapTo(h: number): void {
    restOffsetRef.current = offsetFor(h);
    setVisibleH(h);
    Animated.spring(dragY, { toValue: offsetFor(h), useNativeDriver: true, bounciness: 2, speed: 14 }).start();
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        grabOffsetRef.current = restOffsetRef.current;
        // Grabbing the handle mid-spring should continue from where the sheet
        // actually is, not from where it was heading. This is the one place
        // that asks the native side for the live value, and it costs a single
        // round trip per gesture rather than one per frame.
        dragY.stopAnimation(value => { grabOffsetRef.current = value; });
      },
      onPanResponderMove: (_, g) => {
        dragY.setValue(clampOffset(grabOffsetRef.current + g.dy));
      },
      onPanResponderRelease: (_, g) => {
        const cur = SHEET_H - clampOffset(grabOffsetRef.current + g.dy);
        let target: number;
        if (g.vy < -0.5) target = SNAPS.find(s => s > cur + 4) ?? FULL_H;
        else if (g.vy > 0.5) target = [...SNAPS].reverse().find(s => s < cur - 4) ?? SMALL_H;
        else target = SNAPS.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
        snapTo(target);
      },
      // A gesture taken away mid-drag (the FlatList claiming the scroll) would
      // otherwise leave the sheet parked between snap points.
      onPanResponderTerminate: () => { snapTo(SHEET_H - restOffsetRef.current); },
    }),
  ).current;

  // Switching sections no longer refetches anything. The Me page is part of a
  // screen that never unmounts and never loses focus, so it used to have to ask
  // — a history stretch sent with "Publish this one" was otherwise invisible
  // until the app was relaunched. Publishing now invalidates the feed itself,
  // which reaches this screen wherever the post came from.
  function selectSection(next: HomeSection): void {
    setShowingSuggestions(false);
    setSection(next);
    snapTo(MEDIUM_H);
  }

  function handlePreview(): void {
    setSuggestionKey(k => k + 1);
    setShowingSuggestions(true);
    snapTo(FULL_H);
  }

  function openPostChooser(): void {
    setChoosingPostKind(true);
    Animated.timing(chooserAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }

  /** Slide the chooser away, then run what the publisher picked. */
  function closePostChooser(then?: () => void): void {
    Animated.timing(chooserAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      setChoosingPostKind(false);
      then?.();
    });
  }

  function closeSuggestions(): void {
    setShowingSuggestions(false);
    snapTo(MEDIUM_H);
  }

  // The sheet stays docked to the bottom; its lowest band (behind the nav) is left
  // glassy (no white wash) so the nav reads as glass while content stays clean white.
  const glassBand = insets.bottom + NAV_BAR_H;
  // Everything below the fold is real sheet that happens to hang off the bottom
  // of the screen (see SHEET_H), so the content has to be padded past it as
  // well as past the nav — otherwise the last post sits under the bezel.
  const bottomInset = offsetFor(visibleH) + glassBand + spacing.md;

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
          {/* Frosted glass rather than a flat scrim: over satellite imagery a
              translucent black square reads as a smudge, while a blur keeps the
              icon legible over both bright coastline and dark ocean. */}
          <BlurView intensity={28} tint="light" style={StyleSheet.absoluteFill} />
          <Ionicons name="settings-sharp" size={20} color={headerTint} />
        </TouchableOpacity>
      </View>

      {/* Draggable sheet — solid white all the way down */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY: dragY }] }]}>
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
                <PostCard
                  posting={item}
                  onPress={() => navigation.navigate('Posting', { posting: item })}
                  // Swipe left to reveal Delete; the story viewer keeps an
                  // explicit button for anyone who never discovers the swipe.
                  onDelete={() => {
                    setSwipedPostId(null);
                    moveToTrash(publisherId, item);
                  }}
                  isSwipedOpen={swipedPostId === item.id}
                  onSwipeStateChange={open => setSwipedPostId(open ? item.id : null)}
                />
              )}
              // Fixed-height cards, so the list can skip measuring and mount
              // only what is near the viewport however long the feed gets.
              getItemLayout={(_, index) => ({
                length: POST_CARD_HEIGHT + spacing.md,
                offset: (POST_CARD_HEIGHT + spacing.md) * index,
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
                <View style={styles.profile}>
                  <View style={styles.avatar}>
                    {avatarUrl != null ? (
                      <RemoteImage
                        source={avatarUrl}
                        style={styles.avatarImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={avatarUrl}
                      />
                    ) : (
                      <Ionicons name="camera" size={26} color={colors.accent} />
                    )}
                  </View>
                  {/* Name on top, then the followers count and both actions on
                      a single line beside the photo. */}
                  <View style={styles.profileText}>
                    <Text testID="home-profile-name" style={styles.name} numberOfLines={1}>{displayName}</Text>
                    <View style={styles.metaRow}>
                      <View style={styles.statCol}>
                        <Text style={styles.statNumber}>{followersLoading ? '—' : subscribers.length}</Text>
                        <Text style={styles.statLabel}>
                          {subscribers.length === 1 ? 'Follower' : 'Followers'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        testID="home-add-post"
                        style={styles.addButton}
                        activeOpacity={0.85}
                        onPress={openPostChooser}
                      >
                        <Ionicons name="add" size={14} color="#fff" />
                        <Text style={styles.addButtonText} numberOfLines={1}>Add post</Text>
                      </TouchableOpacity>
                      <TouchableOpacity testID="home-invite" style={styles.inviteButton} activeOpacity={0.85} onPress={shareInvite}>
                        <Ionicons name="person-add-outline" size={13} color={colors.ink} />
                        <Text style={styles.inviteButtonText} numberOfLines={1}>Invite</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              }
            />
          )}
          {!showingSuggestions && section === 'auto' && (
            <AutoPostingSection bottomInset={bottomInset} onPreview={handlePreview} />
          )}
          {!showingSuggestions && section === 'followers' && <FollowersSection bottomInset={bottomInset} />}
          {!showingSuggestions && section === 'history' && (
            <HistoryBackfillContent
              onDone={() => selectSection('me')}
              initialStartDate={tripStartDate}
              gaps={gaps}
              bottomInset={bottomInset}
            />
          )}
        </View>
      </Animated.View>

      {/* Floating segmented nav (changes the sheet content only) */}
      <View style={[styles.navWrap, { bottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
        <SectionNav active={section} onChange={selectSection} showHistory={hasGaps} />
      </View>

      {/* "Add post" asks which way first: let the app pick from the last days of
          photos (the same run as Auto-posting's preview), or choose by hand. */}
      {choosingPostKind && (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.chooserBackdrop, { opacity: chooserAnim }]}>
            <TouchableOpacity
              testID="new-post-backdrop"
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              accessibilityLabel="Dismiss"
              onPress={() => closePostChooser()}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.chooserSheet,
              { paddingBottom: insets.bottom + spacing.lg },
              {
                transform: [
                  {
                    translateY: chooserAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [340, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.chooserHandle} />
            <Text style={styles.chooserTitle}>New post</Text>
            <Text style={styles.chooserSubtitle}>How do you want to pick the photos?</Text>

            <TouchableOpacity
              testID="new-post-suggested"
              style={styles.chooserOption}
              activeOpacity={0.85}
              onPress={() => closePostChooser(handlePreview)}
            >
              <View style={styles.chooserIcon}>
                <Ionicons name="sparkles" size={20} color={colors.accent} />
              </View>
              <View style={styles.chooserOptionText}>
                <Text style={styles.chooserOptionTitle}>Suggest photos for me</Text>
                <Text style={styles.chooserOptionHint}>
                  The app picks the best of your recent photos — review, swap and send.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              testID="new-post-manual"
              style={styles.chooserOption}
              activeOpacity={0.85}
              onPress={() => closePostChooser(() => navigation.navigate('Upload'))}
            >
              <View style={styles.chooserIcon}>
                <Ionicons name="images-outline" size={20} color={colors.accent} />
              </View>
              <View style={styles.chooserOptionText}>
                <Text style={styles.chooserOptionTitle}>Select photos myself</Text>
                <Text style={styles.chooserOptionHint}>Pick them from your library.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              testID="new-post-cancel"
              style={styles.chooserCancel}
              onPress={() => closePostChooser()}
            >
              <Text style={styles.chooserCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}
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
    borderRadius: radius.pill,
    // The blur fills this; overflow clips it to the circle, and the hairline
    // gives the glass an edge so it doesn't dissolve into pale terrain.
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SHEET_H,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
    ...shadow.raised,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm },
  handle: { width: 40, height: 5, borderRadius: radius.pill, backgroundColor: colors.border },
  sheetBody: { flex: 1 },
  meContent: { paddingHorizontal: spacing.xl },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    // Separates the profile block from the post cards below, which are a
    // different kind of thing — without it they read as one block.
    marginBottom: spacing.xxl,
  },
  avatar: {
    width: 64,
    height: 64,
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
  // Followers count + both actions share one line, so the buttons stay compact
  // and shrink rather than push the count off the row on narrow phones.
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  statCol: { flexShrink: 0 },
  statNumber: { ...typography.heading, fontSize: 17, color: colors.text },
  statLabel: { ...typography.caption, fontSize: 11, color: colors.textSecondary, marginTop: -1 },
  addButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: colors.ink,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 11 },
  inviteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  inviteButtonText: { color: colors.ink, fontWeight: '600', fontSize: 11 },
  // A centred capsule 80% of the screen wide: percentage insets rather than
  // fixed points, so it keeps those proportions on a small phone and a tablet
  // alike. `stretch` is what hands the bar that width — without it the bar
  // collapses to the size of its own tabs and drifts off centre.
  navWrap: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  // "New post" chooser
  chooserBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,12,18,0.45)' },
  chooserSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  chooserHandle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  chooserTitle: { ...typography.heading, fontSize: 18, color: colors.text },
  chooserSubtitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  chooserOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  chooserIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chooserOptionText: { flex: 1 },
  chooserOptionTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  chooserOptionHint: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  chooserCancel: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  chooserCancelText: { ...typography.button, fontSize: 14, color: colors.textSecondary },
});
