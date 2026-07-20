import React from 'react';
import { View, Text, Image, TouchableOpacity, FlatList, Dimensions, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { displaySizedUri } from '../../infrastructure/storage/cloudinaryDelivery';
import { colors, radius, spacing } from '../theme/theme';

/** A single photo within a posting. Mirrors the domain `Media`. */
export interface FeedMedia {
  id: string;
  uri?: string;
}

/** A "posting" — the batch of media sent together, with its date and place. */
export interface FeedPosting {
  id: string;
  /** Pre-formatted date label, e.g. "June 18, 2026". */
  date: string;
  /** Place label, e.g. "Lisbon, Portugal" — absent until location lands (issue #23). */
  place?: string;
  /** Cover image shown full-bleed for the post (falls back to first media). */
  coverUri?: string;
  media: FeedMedia[];
}

interface Props {
  postings: FeedPosting[];
  /** Called with the tapped posting — the Me page pushes its detail view. */
  onPressPosting?: (posting: FeedPosting) => void;
  /** Rendered after the last post, scrolling with the feed (e.g. "Add post"). */
  footer?: React.ReactElement;
  /** Extra bottom padding so the end of the feed clears the bottom sheet. */
  bottomPadding?: number;
}

/** Width-to-height ratio of each full-bleed post (tall portrait, Polarsteps-ish). */
const ASPECT = 2 / 3;
/** Every post has the same fixed height — that's what lets the list virtualize cheaply. */
const POST_HEIGHT = Math.round(Dimensions.get('window').width / ASPECT);
/** Covers are delivered resized to roughly the screen, not at original camera size. */
const COVER_WIDTH = 1080;

function Post({ posting, onPress }: { posting: FeedPosting; onPress?: () => void }): React.JSX.Element {
  const rawCover = posting.coverUri ?? posting.media.find(m => m.uri)?.uri;
  const cover = rawCover != null ? displaySizedUri(rawCover, COVER_WIDTH) : undefined;
  return (
    <TouchableOpacity style={styles.post} activeOpacity={0.92} onPress={onPress} disabled={onPress == null}>
      {cover ? (
        <Image source={{ uri: cover }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.placeholder]}>
          <Ionicons name="image-outline" size={40} color={colors.textMuted} />
        </View>
      )}

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.65)']}
        style={styles.scrim}
        pointerEvents="none"
      />

      {posting.media.length > 1 && (
        <View style={styles.countChip}>
          <Ionicons name="copy-outline" size={13} color="#fff" />
          <Text style={styles.countText}>{posting.media.length}</Text>
        </View>
      )}

      <View style={styles.caption}>
        {posting.place != null ? (
          <>
            <Text style={styles.place} numberOfLines={2}>{posting.place}</Text>
            <Text style={styles.date}>{posting.date.toUpperCase()}</Text>
          </>
        ) : (
          <Text style={styles.place} numberOfLines={1}>{posting.date}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

/**
 * Full-bleed feed of the publisher's latest postings — large edge-to-edge
 * cover images stacked with no gaps (Instagram / Polarsteps "memories" style),
 * each with its place + date overlaid. Tapping a post opens it (all its
 * photos) via `onPressPosting`.
 *
 * Virtualized: only the posts near the viewport are mounted, so a feed of
 * hundreds of postings costs the same as a feed of five.
 */
export function PhotoFeed({ postings, onPressPosting, footer, bottomPadding }: Props): React.JSX.Element {
  return (
    <FlatList
      data={postings}
      keyExtractor={p => p.id}
      renderItem={({ item }) => (
        <Post
          posting={item}
          {...(onPressPosting != null ? { onPress: () => onPressPosting(item) } : {})}
        />
      )}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: bottomPadding ?? 0 }}
      ListFooterComponent={footer ?? null}
      getItemLayout={(_, index) => ({ length: POST_HEIGHT, offset: POST_HEIGHT * index, index })}
      initialNumToRender={3}
      maxToRenderPerBatch={4}
      windowSize={5}
      removeClippedSubviews
    />
  );
}

const styles = StyleSheet.create({
  post: { width: '100%', height: POST_HEIGHT, backgroundColor: colors.surfaceAlt },
  image: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  caption: { position: 'absolute', left: spacing.xl, right: spacing.xl, bottom: spacing.xl },
  place: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  date: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.2,
    marginTop: spacing.xs,
  },
  countChip: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  countText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
