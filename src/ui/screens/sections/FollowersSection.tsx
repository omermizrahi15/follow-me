import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePublisherId } from '../../context/AuthContext';
import { useSubscribers } from '../../hooks/useSubscribers';
import { useInviteLink } from '../../hooks/useInviteLink';
import type { SubscriberDto } from '../../../application/dtos';
import { colors, radius, spacing, typography } from '../../theme/theme';

interface Props {
  /** Bottom padding so content clears the floating nav. */
  bottomInset: number;
}

/** Compact followers list + invite, rendered inside the Me-page bottom sheet. */
export function FollowersSection({ bottomInset }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const { subscribers, loading, error, remove } = useSubscribers(publisherId);
  const { shareInvite } = useInviteLink();
  const unreachableCount = subscribers.filter(s => s.status === 'unreachable').length;

  function confirmRemove(subscriber: SubscriberDto): void {
    Alert.alert(
      'Remove follower',
      `${subscriber.contactHandle} will stop receiving your photos. You can re-add them later with your invite link.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void remove(subscriber.id).catch(() => Alert.alert('Could not remove follower', 'Please try again.'));
          },
        },
      ],
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
    >
      <Text testID="followers-title" style={styles.title}>
        Followers{subscribers.length > 0 ? ` · ${subscribers.length}` : ''}
      </Text>

      {unreachableCount > 0 && (
        <Text style={styles.unreachableSummary}>
          {unreachableCount} of {subscribers.length} follower{subscribers.length !== 1 ? 's' : ''} can't be
          reached on WhatsApp — their number may be invalid or they may have blocked messages.
        </Text>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : error != null ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : subscribers.length === 0 ? (
        <Text style={styles.empty}>No followers yet — share your invite link to get started.</Text>
      ) : (
        subscribers.map(s => (
          <View key={s.id} style={styles.row}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={18} color={colors.accentDark} />
            </View>
            <View style={styles.rowInfo}>
              <Text style={styles.rowHandle}>{s.contactHandle}</Text>
              {s.status === 'unreachable' ? (
                <Text style={styles.rowStatusUnreachable}>Unreachable</Text>
              ) : (
                <Text style={styles.rowStatus}>Active</Text>
              )}
            </View>
            <TouchableOpacity style={styles.removeButton} onPress={() => confirmRemove(s)}>
              <Text style={styles.removeButtonText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity testID="followers-share-invite" style={styles.inviteButton} onPress={shareInvite} activeOpacity={0.85}>
        <Ionicons name="share-social" size={16} color={colors.onAccent} />
        <Text style={styles.inviteText}>Share invite link</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  title: { ...typography.heading, fontSize: 16, color: colors.text, marginBottom: spacing.xs },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center', paddingVertical: spacing.md },
  empty: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1 },
  rowHandle: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.text },
  rowStatus: { color: colors.success, fontSize: 11, marginTop: 1 },
  rowStatusUnreachable: { color: colors.danger, fontSize: 11, marginTop: 1 },
  unreachableSummary: { ...typography.caption, color: colors.danger, lineHeight: 18, marginBottom: spacing.xs },
  removeButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeButtonText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  inviteButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  inviteText: { color: colors.onAccent, fontWeight: '600', fontSize: 13 },
});
