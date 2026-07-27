import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  Pressable,
  TouchableOpacity,
  StatusBar,
  StyleSheet,
  Animated,
  PanResponder,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { RootNavigationProp, RootStackParamList } from '../navigation/types';
import type { FeedMedia } from '../components/PhotoFeed';
import { displaySizedUri } from '../../infrastructure/storage/cloudinaryDelivery';
import { colors, radius, spacing } from '../theme/theme';

/** Fraction of the page width that counts as the "go back" tap zone. */
const BACK_ZONE = 0.3;
/** Drag further than this (or flick faster) and the story closes on release. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.7;

/**
 * One posting, opened from the feed — a full-screen story-style viewer
 * (issue #67): one photo at a time, segmented progress on top, tap right/left
 * to advance/go back, swipe between photos. The subscriber web gallery mirrors
 * the same interaction, so publisher and follower see the same thing.
 */
export function PostingDetailScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'Posting'>>();
  const { posting } = route.params;
  const { width, height } = useWindowDimensions();
  const count = posting.media.length;
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<FeedMedia>>(null);
  // The tap handler needs the current index without re-rendering every page
  // Pressable each time the index changes.
  const indexRef = useRef(0);

  // Swiping is the source of truth for the current index; tap zones scroll the
  // list and this callback follows, so both inputs stay consistent.
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible = viewableItems.find(v => v.isViewable);
    if (visible?.index != null) {
      indexRef.current = visible.index;
      setIndex(visible.index);
    }
  }).current;

  const goTo = useCallback(
    (next: number): void => {
      // Tapping past the last photo closes the story — the natural "I'm done".
      if (next >= count) {
        navigation.goBack();
        return;
      }
      if (next < 0) return;
      listRef.current?.scrollToIndex({ index: next, animated: false });
      indexRef.current = next;
      setIndex(next);
    },
    [count, navigation],
  );

  // Swipe down to close, the way a story or a photo viewer does — the photo
  // follows the finger and the close only commits past a distance or a flick,
  // so a lazy vertical drift while paging sideways springs back instead.
  const dragY = useRef(new Animated.Value(0)).current;
  const dismissResponder = useRef(
    PanResponder.create({
      // Claim the gesture only when it is clearly a downward drag. The photo
      // list pages horizontally, so a diagonal must stay with the list.
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.6,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
          // Carry the motion off-screen rather than cutting to the feed.
          Animated.timing(dragY, {
            toValue: height,
            duration: 180,
            useNativeDriver: true,
          }).start(() => navigation.goBack());
          return;
        }
        Animated.spring(dragY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 4,
          speed: 14,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 14 }).start();
      },
    }),
  ).current;

  const renderItem = useCallback(
    ({ item }: { item: FeedMedia }) => {
      const uri = item.uri != null ? displaySizedUri(item.uri, 1080) : undefined;
      return (
        <Pressable
          style={{ width, height }}
          onPress={e => {
            const back = e.nativeEvent.locationX < width * BACK_ZONE;
            goTo(indexRef.current + (back ? -1 : 1));
          }}
        >
          {uri != null ? (
            <Image source={{ uri }} style={styles.photo} resizeMode="contain" />
          ) : (
            <View style={[styles.photo, styles.placeholder]}>
              <Ionicons name="image-outline" size={40} color={colors.textMuted} />
            </View>
          )}
        </Pressable>
      );
    },
    [width, height, goTo],
  );

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY: dragY }] }]}
      {...dismissResponder.panHandlers}
    >
      <StatusBar barStyle="light-content" />
      <FlatList
        ref={listRef}
        data={posting.media}
        keyExtractor={m => m.id}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        // A story is a handful of photos — render them all so paging never blanks.
        initialNumToRender={count}
        windowSize={5}
      />

      {/* Top scrim — keeps segments and titles readable over bright photos. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0)']}
        style={[styles.scrim, { height: insets.top + 96 }]}
        pointerEvents="none"
      />

      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        {/* One progress segment per photo, filled up to the current one. */}
        <View style={styles.segments} pointerEvents="none">
          {posting.media.map((m, i) => (
            <View key={m.id} style={[styles.segment, i <= index && styles.segmentDone]} />
          ))}
        </View>

        <View style={styles.header} pointerEvents="box-none">
          <View style={styles.titles} pointerEvents="none">
            {posting.place != null && <Text style={styles.place}>{posting.place}</Text>}
            <Text style={styles.meta}>
              {posting.date.toUpperCase()} · {index + 1}/{count}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.closeButton}
            accessibilityLabel="Close"
            onPress={() => navigation.goBack()}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  photo: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md },
  segments: { flexDirection: 'row', gap: 4 },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  segmentDone: { backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  titles: { flex: 1 },
  place: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  meta: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.1,
    marginTop: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
