import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSyncStatus } from '../../data/syncStatus';
import { syncStatusCopy } from '../../../domain/services/photoSyncCopy';
import { colors, radius, spacing, typography } from '../../theme/theme';

/**
 * What the photo sync is doing, in one line.
 *
 * Every sync outcome used to look the same from here — which is to say, look
 * like nothing. Uploading, finished, switched off after a cloud wipe, and
 * failing on every attempt were indistinguishable, so a publisher whose sync
 * had been off for a week had no way to find out until the server gave up and
 * pushed "couldn't prepare your post". Worse, the only way to switch it back on
 * was to press Save in these settings, which nothing told them to do.
 *
 * So this row states the state and, when the user is the only one who can fix
 * it, offers the action right here. The strings themselves live in
 * `domain/services/photoSyncCopy` where they are unit-tested.
 */

interface Props {
  /** Turn sync on (prompting for consent if needed) and start a run. */
  onEnable: () => void;
  /** Re-run a sync after a failure. */
  onRetry: () => void;
}

export function PhotoSyncStatus({ onEnable, onRetry }: Props): React.ReactElement {
  const status = useSyncStatus();
  const { title, hint, action } = syncStatusCopy(status, Date.now());
  const off = status.phase === 'paused' || status.phase === 'no-consent';
  const failed = status.phase === 'failed';

  return (
    <View style={[styles.block, (off || failed) && styles.blockAttention]}>
      <View style={styles.row}>
        {status.phase === 'syncing' ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Ionicons
            name={off ? 'cloud-offline-outline' : failed ? 'alert-circle-outline' : 'cloud-done-outline'}
            size={18}
            color={off || failed ? colors.danger : colors.success}
          />
        )}
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

      {/* A first sync over a wide lookback is minutes of work at three photos at
          a time. Without a bar it reads as a hang — which is exactly how one got
          force-quit halfway through. */}
      {status.phase === 'syncing' && status.total > 0 && (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.min(100, Math.round((status.uploaded / status.total) * 100))}%` },
            ]}
          />
        </View>
      )}

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
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
