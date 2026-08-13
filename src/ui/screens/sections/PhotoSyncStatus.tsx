import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSyncStatus } from '../../data/syncStatus';
import { syncStatusCopy } from '../../../domain/services/photoSyncCopy';
import { colors, radius, spacing, typography } from '../../theme/theme';

/**
 * The photo sync, but only when the publisher has to do something about it.
 *
 * Uploading is automatic — on launch, on every foreground, from a background
 * task and from a silent push — so narrating it was worse than saying nothing:
 * a permanent row about "syncing" reads as a chore with a schedule, and the
 * first question it provokes ("when am I supposed to sync?") has no answer.
 *
 * What genuinely needs saying is the opposite state. A publisher whose upload
 * is off has no way to discover it — photos simply never arrive, and days later
 * the server pushes "couldn't prepare your post" (issue #97). So this renders
 * nothing while sync is healthy or running, and appears with the one action
 * that fixes it when it isn't. The strings live in
 * `domain/services/photoSyncCopy` where they are unit-tested.
 */

interface Props {
  /** Turn sync on (prompting for consent if needed) and start a run. */
  onEnable: () => void;
  /** Re-run a sync after a failure. */
  onRetry: () => void;
}

export function PhotoSyncStatus({ onEnable, onRetry }: Props): React.ReactElement | null {
  const status = useSyncStatus();
  const { title, hint, action, needsAttention } = syncStatusCopy(status, Date.now());
  if (!needsAttention) return null;

  const failed = status.phase === 'failed';

  return (
    <View style={[styles.block, styles.blockAttention]}>
      <View style={styles.row}>
        <Ionicons
          name={failed ? 'alert-circle-outline' : 'cloud-offline-outline'}
          size={18}
          color={colors.danger}
        />
        <Text style={styles.title} testID="photo-sync-status-title">
          {title}
        </Text>
        {action != null && (
          <TouchableOpacity
            testID="photo-sync-status-action"
            onPress={failed ? onRetry : onEnable}
            hitSlop={8}
          >
            <Text style={styles.action}>{action}</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  blockAttention: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  action: {
    ...typography.button,
    color: colors.accent,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
