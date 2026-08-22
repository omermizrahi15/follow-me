import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { ErrorState } from '../../components/ErrorState';
import { ListRowSkeleton, SkeletonList } from '../../components/Skeleton';
import { alertFailure, refuseIfOffline } from '../../data/writeGuard';
import { useAuth, usePublisherId } from '../../context/AuthContext';
import { useSubscribers } from '../../hooks/useSubscribers';
import { useContactNames } from '../../hooks/useContactNames';
import { useInviteLink } from '../../hooks/useInviteLink';
import type { SubscriberDto } from '../../../application/dtos';
import { sortByResolvedName } from '../../../domain/services/contactNames';
import { colors, radius, spacing, typography } from '../../theme/theme';

interface Props {
  /** Bottom padding so content clears the floating nav. */
  bottomInset: number;
}

/** Compact followers list + invite, rendered inside the Me-page bottom sheet. */
export function FollowersSection({ bottomInset }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const { publisherPhone } = useAuth();
  const { subscribers, loading, error, reload, remove } = useSubscribers(publisherId);
  const { shareInvite } = useInviteLink();
  const unreachableCount = subscribers.filter(s => s.status === 'unreachable').length;

  // Followers are shown by contact name where the device address book knows the
  // number (issue #144). Matching happens on the device; nothing about the
  // publisher's contacts is sent anywhere.
  const handles = useMemo(() => subscribers.map(s => s.contactHandle), [subscribers]);
  const { names, access, enable } = useContactNames(handles, publisherPhone);
  const rows = useMemo(
    () => sortByResolvedName(subscribers, s => names.get(s.contactHandle)?.name ?? null, s => s.contactHandle),
    [subscribers, names],
  );

  function confirmRemove(subscriber: SubscriberDto): void {
    // Asked before the confirmation dialog, not after it: agreeing to something
    // that cannot happen and only then being told is the sequence #145 is about.
    if (refuseIfOffline('Removing a follower')) return;
    // Name the follower where we can: "Remove +972501234567" is exactly the
    // prompt where the publisher cannot tell who they are about to cut off.
    const contact = names.get(subscriber.contactHandle);
    const who = contact != null
      ? `${contact.name} (${subscriber.contactHandle})`
      : subscriber.contactHandle;
    Alert.alert(
      'Remove follower',
      `${who} will stop receiving your photos. You can re-add them later with your invite link.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void remove(subscriber.id).catch((e: unknown) => alertFailure(e, 'Couldn’t remove this follower'));
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

      {access === 'undetermined' && subscribers.length > 0 && (
        <TouchableOpacity
          testID="followers-use-contacts"
          style={styles.contactsPrompt}
          onPress={() => void enable()}
          activeOpacity={0.85}
        >
          <Ionicons name="person-circle-outline" size={18} color={colors.accentDark} />
          <Text style={styles.contactsPromptText}>
            Show names instead of numbers — match followers against this phone's contacts. Your
            contacts stay on the device.
          </Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <SkeletonList count={3} render={() => <ListRowSkeleton />} />
      ) : error != null ? (
        // A bare red line with no way to act on it was the old failure state:
        // the list simply looked empty, and "share your invite link" was the
        // advice given to someone whose followers had failed to load (#145).
        <ErrorState
          error={error}
          title="Couldn’t load your followers"
          onRetry={() => void reload()}
          compact
        />
      ) : subscribers.length === 0 ? (
        <Text style={styles.empty}>No followers yet — share your invite link to get started.</Text>
      ) : (
        rows.map(s => {
          const contact = names.get(s.contactHandle);
          return (
            <View key={s.id} style={styles.row}>
              {contact?.imageUri != null ? (
                <Image source={{ uri: contact.imageUri }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={styles.avatar}>
                  <Ionicons name="person" size={18} color={colors.accentDark} />
                </View>
              )}
              <View style={styles.rowInfo}>
                <Text style={styles.rowHandle} numberOfLines={1}>
                  {contact?.name ?? s.contactHandle}
                </Text>
                {/* The number stays visible under a matched name — it is what
                    WhatsApp actually delivers to. */}
                {s.status === 'unreachable' ? (
                  <Text style={styles.rowStatusUnreachable} numberOfLines={1}>
                    Unreachable{contact != null ? ` · ${s.contactHandle}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.rowStatus} numberOfLines={1}>
                    Active{contact != null ? ` · ${s.contactHandle}` : ''}
                  </Text>
                )}
              </View>
              <TouchableOpacity style={styles.removeButton} onPress={() => confirmRemove(s)}>
                <Text style={styles.removeButtonText}>Remove</Text>
              </TouchableOpacity>
            </View>
          );
        })
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
  contactsPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  contactsPromptText: { ...typography.caption, flex: 1, color: colors.accentDark, lineHeight: 17 },
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
