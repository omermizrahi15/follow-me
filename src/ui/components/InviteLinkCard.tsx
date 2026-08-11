import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInviteLink } from '../hooks/useInviteLink';
import { colors, radius, spacing, typography } from '../theme/theme';

type Props = {
  /** Optional caption shown above the link. */
  hint?: string;
};

/**
 * Reusable invite block: shows the publisher's join link in a soft pill and a
 * primary "Share invite link" button. Used in onboarding and the post-share
 * prompt so the link UI and share copy live in one place.
 */
export function InviteLinkCard({ hint }: Props): React.JSX.Element {
  const { joinLink, shareInvite } = useInviteLink();

  return (
    <View>
      {hint != null && <Text style={styles.hint}>{hint}</Text>}
      <View style={styles.linkBox}>
        <Ionicons name="link" size={15} color={colors.textMuted} />
        <Text style={styles.linkText} numberOfLines={1}>
          {joinLink ?? 'Sign in to get your link'}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.shareButton, joinLink == null && styles.disabled]}
        onPress={shareInvite}
        disabled={joinLink == null}
        activeOpacity={0.85}
      >
        <Ionicons name="share-social" size={16} color={colors.onAccent} />
        <Text style={styles.shareText}>Share invite link</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  linkText: { flex: 1, color: colors.textSecondary, fontSize: 13 },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  disabled: { opacity: 0.5 },
  shareText: { color: colors.onAccent, fontWeight: '600', fontSize: 14 },
});
