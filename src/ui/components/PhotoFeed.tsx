import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { MediaType } from '../../domain/entities/Media';
import { colors, radius, spacing } from '../theme/theme';

/** A single media item within a posting. Mirrors the domain `Media`. */
export interface FeedMedia {
  id: string;
  type: MediaType;
  uri?: string;
}

/** A "posting" — the batch of media sent together, with its date and place. */
export interface FeedPosting {
  id: string;
  /** Pre-formatted date label, e.g. "June 18, 2026". */
  date: string;
  /** Place label, e.g. "Lisbon, Portugal". */
  place: string;
  /** Cover image shown full-bleed for the post (falls back to first media). */
  coverUri?: string;
  media: FeedMedia[];
}

interface Props {
  postings: FeedPosting[];
}

/** Width-to-height ratio of each full-bleed post (portrait, Instagram-ish). */
const ASPECT = 4 / 5;

function hasVideo(media: FeedMedia[]): boolean {
  return media.some(m => m.type === 'video');
}

function Post({ posting }: { posting: FeedPosting }): React.JSX.Element {
  const cover = posting.coverUri ?? posting.media.find(m => m.uri)?.uri;
  return (
    <View style={styles.post}>
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
        <Text style={styles.place} numberOfLines={2}>{posting.place}</Text>
        <Text style={styles.date}>{posting.date.toUpperCase()}</Text>
      </View>

      {hasVideo(posting.media) && (
        <View style={styles.playBadge}>
          <Ionicons name="play" size={22} color="#fff" style={{ marginLeft: 3 }} />
        </View>
      )}
    </View>
  );
}

/**
 * Full-bleed feed of the publisher's latest postings — large edge-to-edge
 * cover images stacked with no gaps (Instagram / Polarsteps "memories" style),
 * each with its place + date overlaid and a play badge when it holds video.
 */
export function PhotoFeed({ postings }: Props): React.JSX.Element {
  return (
    <View>
      {postings.map(p => (
        <Post key={p.id} posting={p} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  post: { width: '100%', aspectRatio: ASPECT, backgroundColor: colors.surfaceAlt },
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
  playBadge: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
