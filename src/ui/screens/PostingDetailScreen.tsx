import React from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { RootNavigationProp, RootStackParamList } from '../navigation/types';
import type { FeedMedia } from '../components/PhotoFeed';
import { SongBar } from '../components/SongBar';
import { displaySizedUri } from '../../infrastructure/storage/cloudinaryDelivery';
import { colors, radius, shadow, spacing } from '../theme/theme';

/** Width-to-height ratio of each photo in the posting (matches the feed). */
const ASPECT = 4 / 5;

function MediaItem({ media }: { media: FeedMedia }): React.JSX.Element {
  const uri = media.uri != null ? displaySizedUri(media.uri, 1080) : undefined;
  return (
    <View style={styles.mediaItem}>
      {uri != null ? (
        <Image source={{ uri }} style={styles.mediaImage} resizeMode="cover" />
      ) : (
        <View style={[styles.mediaImage, styles.placeholder]}>
          <Ionicons name="image-outline" size={40} color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}

/**
 * One posting, opened by tapping it in the feed: every photo of the batch
 * stacked full-width, with the posting's place and date up top.
 */
export function PostingDetailScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'Posting'>>();
  const { posting } = route.params;
  const count = posting.media.length;

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + spacing.xxl }}
      >
        <View style={styles.titleBlock}>
          {posting.place != null && <Text style={styles.place}>{posting.place}</Text>}
          <Text style={styles.date}>
            {posting.date.toUpperCase()} · {count} {count === 1 ? 'ITEM' : 'ITEMS'}
          </Text>
          {posting.song != null && (
            <View style={styles.songBar}>
              <SongBar song={posting.song} />
            </View>
          )}
        </View>
        {posting.media.map(m => (
          <MediaItem key={m.id} media={m} />
        ))}
      </ScrollView>

      {/* Floating back button — solid light pill so it reads over photos too */}
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + spacing.sm }]}
        accessibilityLabel="Back"
        onPress={() => navigation.goBack()}
      >
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backButton: {
    position: 'absolute',
    left: spacing.xl,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  titleBlock: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  songBar: { marginTop: spacing.md },
  place: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  date: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.2,
    marginTop: spacing.xs,
  },
  mediaItem: { width: '100%', aspectRatio: ASPECT, marginBottom: 2, backgroundColor: colors.surfaceAlt },
  mediaImage: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
});
