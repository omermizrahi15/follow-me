import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { usePublisherId } from '../context/AuthContext';
import { useSubscribers } from '../hooks/useSubscribers';
import type { SubscriberDto } from '../../application/dtos';
import { colors, radius, spacing, typography } from '../theme/theme';

// The public subscribe page (hosted on GitHub Pages). Opening it lets a
// follower enter their WhatsApp number and subscribe — the page posts to the
// `subscribe` edge function. The publisher id travels as the `?p=` query param.
const JOIN_BASE_URL = 'https://omermizrahi15.github.io/follow-me/join/';

/** The Followers tab — view and remove your subscribers, plus your invite link. */
export function SubscribersScreen(): React.JSX.Element {
  const publisherId = usePublisherId();
  const { subscribers, loading, error, remove } = useSubscribers(publisherId);
  const joinLink = `${JOIN_BASE_URL}?p=${publisherId}`;

  function handleShareLink(): void {
    // Only pass `message` (link inline). Passing `url` too makes iOS attach the
    // link as a separate NSURL item, which targets like WhatsApp serialize as a
    // binary plist (bplist00...) instead of plain text.
    void Share.share({
      message: `Follow me on Follow Me! You'll receive my photos on WhatsApp: ${joinLink}`,
    });
  }

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
            void remove(subscriber.id).catch(() => {
              Alert.alert('Could not remove follower', 'Please try again.');
            });
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Followers" showBack={false} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.summary}>
          {subscribers.length === 0
            ? 'People who follow you receive your photos on WhatsApp'
            : `${subscribers.length} ${subscribers.length === 1 ? 'person follows' : 'people follow'} you`}
        </Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error != null ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : subscribers.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No followers yet</Text>
            <Text style={styles.emptyDescription}>
              Share your invite link to start building your audience.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {subscribers.map(subscriber => (
              <View key={subscriber.id} style={styles.row}>
                <View style={styles.avatar}>
                  <Ionicons name="person" size={20} color={colors.accentDark} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowHandle}>{subscriber.contactHandle}</Text>
                  <Text style={styles.rowStatus}>Active</Text>
                </View>
                <TouchableOpacity style={styles.removeButton} onPress={() => confirmRemove(subscriber)}>
                  <Text style={styles.removeButtonText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.inviteSection}>
          <Text style={styles.sectionTitle}>Add more followers</Text>
          <Text style={styles.hint}>
            Share this link — people register automatically and start receiving your photos on WhatsApp.
          </Text>
          <View style={styles.linkBox}>
            <Text style={styles.linkText} numberOfLines={1}>{joinLink}</Text>
          </View>
          <TouchableOpacity style={styles.shareLink} onPress={handleShareLink}>
            <Ionicons name="logo-whatsapp" size={18} color={colors.onAccent} />
            <Text style={styles.shareLinkText}>Share invite link</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 120 },
  summary: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg },
  center: { paddingVertical: 48, alignItems: 'center' },
  errorText: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  emptyTitle: { ...typography.heading, fontSize: 16, color: colors.text },
  emptyDescription: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  list: { gap: spacing.md, marginBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1 },
  rowHandle: { ...typography.body, fontSize: 15, fontWeight: '600', color: colors.text },
  rowStatus: { color: colors.success, fontSize: 12, marginTop: 2 },
  removeButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeButtonText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  inviteSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { ...typography.heading, fontSize: 15, color: colors.text, marginBottom: spacing.md },
  hint: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.md, lineHeight: 18 },
  linkBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkText: { color: colors.textSecondary, fontSize: 12, fontFamily: 'monospace' },
  shareLink: {
    backgroundColor: colors.whatsapp,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  shareLinkText: { color: colors.onAccent, fontWeight: '600', fontSize: 14 },
});
