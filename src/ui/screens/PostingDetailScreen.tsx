import React from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { RootNavigationProp, RootStackParamList } from '../navigation/types';
import type { FeedMedia } from '../components/PhotoFeed';
import { mediaPreviewUri } from '../utils/mediaPreview';
import { colors, radius, spacing } from '../theme/theme';

/** Width-to-height ratio of each photo in the posting (matches the feed). */
const ASPECT = 4 / 5;

function MediaItem({ media }: { media: FeedMedia }): React.JSX.Element {
  const uri = mediaPreviewUri(media);
  return (
    <View style={styles.mediaItem}>
      {uri != null ? (
        <Image source={{ uri }} style={styles.mediaImage} resizeMode="cover" />
      ) : (
        <View style={[styles.mediaImage, styles.placeholder]}>
          <Ionicons name="image-outline" size={40} color={colors.textMuted} />
        </View>
      )}
      {media.type === 'video' && (
        <View style={styles.playBadge}>
          <Ionicons name="play" size={22} color="#fff" style={{ marginLeft: 3 }} />
        </View>
      )}
    </View>
  );
}

/**
 * One posting, opened by tapping it in the feed: every photo and video of the
 * batch stacked full-width, with the posting's place and date up top.
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
        </View>
        {posting.media.map(m => (
          <MediaItem key={m.id} media={m} />
        ))}
      </ScrollView>

      {/* Top scrim + floating back button, same language as the Me page header */}
      <LinearGradient
        colors={['rgba(8,12,18,0.55)', 'transparent']}
        style={[styles.topScrim, { height: insets.top + 64 }]}
        pointerEvents="none"
      />
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + spacing.sm }]}
        accessibilityLabel="Back"
        onPress={() => navigation.goBack()}
      >
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0E141C' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  backButton: {
    position: 'absolute',
    left: spacing.xl,
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  place: { color: '#fff', fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  date: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.2,
    marginTop: spacing.xs,
  },
  mediaItem: { width: '100%', aspectRatio: ASPECT, marginBottom: 2, backgroundColor: colors.surfaceAlt },
  mediaImage: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
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
