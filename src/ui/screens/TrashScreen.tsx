import React from 'react';
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScreenHeader } from '../components/ScreenHeader';
import { ErrorState } from '../components/ErrorState';
import { Photo } from '../components/Photo';
import { alertFailure } from '../data/writeGuard';
import { ListRowSkeleton, SkeletonList } from '../components/Skeleton';
import { usePublisherId } from '../context/AuthContext';
import { useTrashedPostings } from '../hooks/useTrash';
import { formatPostingDate, type FeedPosting } from '../data/feed';
import { displaySizedUri } from '../../domain/services/mediaDisplayUri';
import { colors, radius, spacing, typography } from '../theme/theme';

/** The thumbnail is small; ask Cloudinary for a matching crop, not the original. */
const THUMB_WIDTH = 160;

/**
 * Settings → Deleted posts. Everything the publisher has removed from their
 * feed, newest deletion first, each restorable in one tap.
 *
 * Deleting is a soft delete precisely so this page can exist — nothing here
 * expires or is purged, so a post removed by mistake is always recoverable.
 */
export function TrashScreen(): React.JSX.Element {
  const publisherId = usePublisherId();
  const { postings, loading, error, reload, restore } = useTrashedPostings(publisherId);

  function handleRestore(posting: FeedPosting): void {
    void restore(posting.id).catch((e: unknown) => alertFailure(e, 'Couldn’t restore this post'));
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Deleted posts" />
      <FlatList
        data={postings}
        keyExtractor={p => p.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <TrashRow posting={item} onRestore={() => handleRestore(item)} />}
        ListEmptyComponent={
          // "Nothing deleted" used to show for a failed load too, which reads
          // as "your deleted posts are gone" — the opposite of what this page
          // exists to promise (issue #145).
          loading ? (
            <SkeletonList count={3} render={() => <ListRowSkeleton thumb="square" />} />
          ) : error != null ? (
            <ErrorState
              error={error}
              title="Couldn’t load your deleted posts"
              onRetry={() => void reload()}
            />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="trash-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Nothing deleted</Text>
              <Text style={styles.emptyHint}>
                Posts you delete land here, and stay until you restore them.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

function TrashRow({
  posting,
  onRestore,
}: {
  posting: FeedPosting;
  onRestore: () => void;
}): React.JSX.Element {
  const rawCover = posting.coverUri ?? posting.media.find(m => m.uri)?.uri;
  const cover = rawCover != null ? displaySizedUri(rawCover, THUMB_WIDTH) : undefined;
  const photoCount = posting.media.length;

  return (
    <View style={styles.row} testID={`trash-row-${posting.id}`}>
      <Photo uri={cover} style={styles.thumb} recyclingKey={cover} iconSize={20} />

      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>{posting.place ?? posting.date}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {posting.date} · {photoCount} photo{photoCount === 1 ? '' : 's'}
        </Text>
        {posting.deletedAt != null && (
          <Text style={styles.rowDeleted}>Deleted {formatPostingDate(posting.deletedAt)}</Text>
        )}
      </View>

      <TouchableOpacity
        testID={`trash-restore-${posting.id}`}
        style={styles.restoreButton}
        onPress={onRestore}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Restore ${posting.place ?? posting.date}`}
      >
        <Ionicons name="arrow-undo-outline" size={15} color={colors.onAccent} />
        <Text style={styles.restoreText}>Restore</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.sm },
  center: { paddingVertical: spacing.xxl, alignItems: 'center' },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  emptyHint: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.text },
  rowMeta: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  rowDeleted: { ...typography.caption, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  restoreText: { color: colors.onAccent, fontWeight: '600', fontSize: 12 },
});
