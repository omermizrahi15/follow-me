import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RootNavigationProp } from '../navigation/types';
import { useSuggestedPhotos } from '../hooks/useSuggestedPhotos';
import { useShareMedia } from '../hooks/useShareMedia';
import { usePublisherId } from '../context/AuthContext';
import type { PhotoCategory } from '../../domain/entities/PhotoClassification';
import { colors, radius, spacing, typography } from '../theme/theme';

type Props = { navigation: RootNavigationProp };

const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  selfie_with_view: 'Selfie + view',
  selfie_with_people: 'Selfie + people',
  view_only: 'View',
  food: 'Food',
  other: 'Other',
};

export function ReviewSuggestionScreen({ navigation }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const { loading, error, batch, reload } = useSuggestedPhotos(publisherId);
  const { share, loading: sharing, error: shareError } = useShareMedia();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);

  const kept = useMemo(
    () => batch.filter(c => !removed.has(c.candidate.id)),
    [batch, removed],
  );

  function toggleRemove(id: string): void {
    setRemoved(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function handleConfirm(): void {
    void (async (): Promise<void> => {
      const items = kept.map(c => ({
        mediaId: c.candidate.id,
        localUri: c.candidate.uri,
        filename: c.candidate.uri.split('/').pop() ?? `${c.candidate.id}.jpg`,
      }));
      try {
        await share(items, publisherId);
        setDone(true);
      } catch {
        /* surfaced via shareError */
      }
    })();
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <View style={styles.successBadge}>
            <Ionicons name="checkmark" size={40} color={colors.onAccent} />
          </View>
          <Text style={styles.successTitle}>Posted!</Text>
          <Text style={styles.successSubtitle}>
            {kept.length} photo{kept.length === 1 ? '' : 's'} sent to your followers.
          </Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()}>
            <Text style={styles.secondaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Suggested post</Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            accessibilityLabel="Close"
            hitSlop={8}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>
          We picked these from your recent photos. Remove any you don't want, then post.
        </Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.hint}>Finding your best recent photos…</Text>
        </View>
      ) : error != null ? (
        <View style={styles.centered}>
          <Text style={styles.errorNote}>{error}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={reload}>
            <Text style={styles.secondaryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : kept.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.hint}>No new photos to suggest right now.</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={reload}>
            <Text style={styles.secondaryText}>Rescan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
            {kept.map(c => (
              <View key={c.candidate.id} style={styles.card}>
                <Image source={{ uri: c.candidate.uri }} style={styles.photo} />
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => toggleRemove(c.candidate.id)}
                  accessibilityLabel="Remove photo"
                  hitSlop={6}
                >
                  <Ionicons name="close" size={16} color={colors.onAccent} />
                </TouchableOpacity>
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{CATEGORY_LABEL[c.category]}</Text>
                </View>
                {c.caption !== '' && (
                  <Text style={styles.caption} numberOfLines={1}>{c.caption}</Text>
                )}
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            {shareError != null && <Text style={styles.errorNote}>{shareError}</Text>}
            <TouchableOpacity
              style={[styles.confirmButton, sharing && styles.disabled]}
              onPress={handleConfirm}
              disabled={sharing}
              activeOpacity={0.85}
            >
              {sharing ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.confirmText}>
                  Post {kept.length} photo{kept.length === 1 ? '' : 's'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl },
  header: { paddingTop: spacing.lg, paddingBottom: spacing.lg },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  hint: { ...typography.caption, color: colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingVertical: spacing.md, paddingBottom: 140 },
  card: { width: '47%' },
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  removeButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(19,33,43,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    position: 'absolute',
    bottom: spacing.lg + 18,
    left: spacing.sm,
    backgroundColor: colors.frosted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: { ...typography.caption, fontSize: 11, fontWeight: '600', color: colors.ink },
  caption: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs },
  footer: { position: 'absolute', bottom: 110, left: spacing.xl, right: spacing.xl },
  errorNote: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm },
  confirmButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  confirmText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
  successBadge: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { ...typography.title, fontSize: 28, color: colors.text },
  successSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.xxl },
  secondaryButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.text, fontWeight: '600' },
});
