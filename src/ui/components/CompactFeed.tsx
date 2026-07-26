import React from 'react';
import { View, Text, Image, TouchableOpacity, Dimensions, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { displaySizedUri } from '../../infrastructure/storage/cloudinaryDelivery';
import type { FeedPosting } from './PhotoFeed';
import { colors, radius, spacing } from '../theme/theme';

/**
 * Wide-and-short, the proportions a trip card has in the sheet — the opposite
 * of the old full-bleed feed, which was one tall portrait per screen.
 */
const ASPECT = 16 / 9;
const CARD_WIDTH = Dimensions.get('window').width - spacing.xl * 2;
export const CARD_HEIGHT = Math.round(CARD_WIDTH / ASPECT);
/** Cards are half-width of the old full-bleed post; ask for half the pixels. */
const COVER_WIDTH = 720;

interface Props {
  posting: FeedPosting;
  onPress?: () => void;
}

/**
 * One post as it appears inside the Me sheet: a wide cover with the place and
 * date over a scrim. Exported as a single card (not a list) because the sheet
 * renders them inside its own FlatList — a scrollable list nested in the
 * sheet's scroll view would fight it for the gesture.
 */
export function CompactFeedCard({ posting, onPress }: Props): React.JSX.Element {
  const rawCover = posting.coverUri ?? posting.media.find(m => m.uri)?.uri;
  const cover = rawCover != null ? displaySizedUri(rawCover, COVER_WIDTH) : undefined;
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.9}
      onPress={onPress}
      disabled={onPress == null}
      testID={`compact-post-${posting.id}`}
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
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    height: CARD_HEIGHT,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.md,
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
