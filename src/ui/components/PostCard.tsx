import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { displaySizedUri } from '../../domain/services/mediaDisplayUri';
import type { FeedPosting } from '../data/feed';
import { colors, radius, spacing } from '../theme/theme';

/** Wide and short — the proportions a trip card has in the sheet. */
const ASPECT = 16 / 9;
const CARD_WIDTH = Dimensions.get('window').width - spacing.xl * 2;
export const POST_CARD_HEIGHT = Math.round(CARD_WIDTH / ASPECT);
/** Cards are half-width of the old full-bleed post; ask for half the pixels. */
const COVER_WIDTH = 720;

/** How far the card parks left, and how wide the Delete button behind it is. */
const ACTION_WIDTH = 92;
/** A drag that starts this horizontal before the list claims it as a scroll. */
const SWIPE_SLOP = 8;
/** A flick faster than this opens or closes regardless of how far it travelled. */
const FLICK_VELOCITY = 0.35;

interface Props {
  posting: FeedPosting;
  onPress?: () => void;
  /** Swipe-left reveals Delete; omit and the card doesn't swipe at all. */
  onDelete?: () => void;
  /** Whether this card's Delete is showing — only one row opens at a time. */
  isSwipedOpen?: boolean;
  /** Fires when this card opens or closes, so the feed can close the others. */
  onSwipeStateChange?: (open: boolean) => void;
}

/**
 * One post as it appears in the feed inside the Me sheet: a wide cover with the
 * place and date over a scrim.
 *
 * A card, not a list. The feed IS the sheet's own FlatList — nesting a second
 * scrollable list inside it would fight it for the gesture.
 *
 * Swiping it left reveals a red Delete, the way an iOS list row does: the swipe
 * plus a deliberate tap on the button is the confirmation, so there is no extra
 * dialog. Built on PanResponder rather than a gesture library because the app
 * has none, and the sheet and the story viewer already do their gestures this
 * way — adding a native dependency here would cost a rebuild for one animation.
 */
export function PostCard({
  posting,
  onPress,
  onDelete,
  isSwipedOpen = false,
  onSwipeStateChange,
}: Props): React.JSX.Element {
  const rawCover = posting.coverUri ?? posting.media.find(m => m.uri)?.uri;
  const cover = rawCover != null ? displaySizedUri(rawCover, COVER_WIDTH) : undefined;

  const translateX = useRef(new Animated.Value(0)).current;
  // Where the card is parked (0 closed, -ACTION_WIDTH open). A ref, not state:
  // the pan handlers below are created once and must never read a stale value.
  const offsetRef = useRef(0);
  const startRef = useRef(0);

  const settle = useCallback(
    (to: number): void => {
      offsetRef.current = to;
      Animated.spring(translateX, {
        toValue: to,
        useNativeDriver: true,
        bounciness: 0,
        speed: 18,
      }).start();
    },
    [translateX],
  );

  // The responder is built once, so it reads the current props through a ref
  // that every render refreshes.
  const latest = useRef({ onSwipeStateChange, swipeable: onDelete != null });
  useEffect(() => {
    latest.current = { onSwipeStateChange, swipeable: onDelete != null };
  });

  const swipeResponder = useRef(
    PanResponder.create({
      // Claim only a clearly horizontal drag. The feed scrolls vertically under
      // this card, so anything diagonal has to stay with the list.
      onMoveShouldSetPanResponder: (_, g) =>
        latest.current.swipeable &&
        Math.abs(g.dx) > SWIPE_SLOP &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        startRef.current = offsetRef.current;
      },
      onPanResponderMove: (_, g) => {
        // Left only, and never further than the button is wide.
        translateX.setValue(Math.min(0, Math.max(-ACTION_WIDTH, startRef.current + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const x = startRef.current + g.dx;
        // A flick decides on its own; a slow drag is judged on distance.
        const open =
          g.vx > FLICK_VELOCITY
            ? false
            : g.vx < -FLICK_VELOCITY || x < -ACTION_WIDTH / 2;
        settle(open ? -ACTION_WIDTH : 0);
        latest.current.onSwipeStateChange?.(open);
      },
      onPanResponderTerminate: () => settle(offsetRef.current),
    }),
  ).current;

  // Another card opened (or the feed reloaded) — close this one.
  useEffect(() => {
    if (!isSwipedOpen && offsetRef.current !== 0) settle(0);
  }, [isSwipedOpen, settle]);

  function handlePress(): void {
    // An open row swallows the tap to close itself, as an iOS list row does,
    // rather than opening the post the publisher was aiming to delete.
    if (offsetRef.current !== 0) {
      settle(0);
      onSwipeStateChange?.(false);
      return;
    }
    onPress?.();
  }

  return (
    <View style={styles.row}>
      {onDelete != null && (
        // Sits behind the card and is revealed by it moving, so it never needs
        // an animation of its own.
        <View style={styles.actionLayer} pointerEvents="box-none">
          <TouchableOpacity
            testID={`post-card-delete-${posting.id}`}
            style={styles.deleteAction}
            onPress={onDelete}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${posting.place ?? posting.date}`}
          >
            <Ionicons name="trash" size={20} color="#fff" />
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      <Animated.View
        style={[styles.cardShell, { transform: [{ translateX }] }]}
        {...swipeResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.9}
          onPress={handlePress}
          disabled={onPress == null && onDelete == null}
          testID={`post-card-${posting.id}`}
          // Swiping is unreachable with a screen reader, so expose the same
          // action as a VoiceOver rotor entry.
          {...(onDelete != null
            ? {
                accessibilityActions: [{ name: 'delete', label: 'Delete post' }],
                onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
                  if (e.nativeEvent.actionName === 'delete') onDelete();
                },
              }
            : {})}
        >
          {cover != null ? (
            <Image source={{ uri: cover }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={[styles.image, styles.placeholder]}>
              <Ionicons name="image-outline" size={28} color={colors.textMuted} />
            </View>
          )}

          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.scrim}
            pointerEvents="none"
          />

          {posting.media.length > 1 && (
            <View style={styles.countChip}>
              <Ionicons name="copy-outline" size={11} color="#fff" />
              <Text style={styles.countText}>{posting.media.length}</Text>
            </View>
          )}

          <View style={styles.caption}>
            {posting.place != null ? (
              <>
                <Text style={styles.place} numberOfLines={1}>{posting.place}</Text>
                <Text style={styles.date}>{posting.date.toUpperCase()}</Text>
              </>
            ) : (
              <Text style={styles.place} numberOfLines={1}>{posting.date}</Text>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Clips the sliding card to the card's own rounded corners, so the red
  // behind it never shows a square edge. Carries the gap between cards that
  // the card itself used to, keeping the feed's getItemLayout maths unchanged.
  row: {
    height: POST_CARD_HEIGHT,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.danger,
  },
  actionLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'flex-end' },
  deleteAction: {
    width: ACTION_WIDTH,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  deleteText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  cardShell: { width: '100%', height: '100%' },
  card: {
    width: '100%',
    height: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  image: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  caption: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.md },
  place: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  date: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 2,
  },
  countChip: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  countText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});
