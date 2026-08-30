import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { AiUsageLevel, AiUsageSummary } from '../../domain/entities/AiUsage';
import { aiUsageCopy } from '../../domain/services/aiUsage';
import { showDevTools } from '../data/devTools';
import { useAiUsage } from '../hooks/useAiUsage';
import { colors, radius, spacing, typography } from '../theme/theme';

/**
 * "How much AI have I got left today", on the staging build only.
 *
 * The number is the per-user daily classify quota (`classify_quota`, migration
 * 20240015) against the server's own CLASSIFY_DAILY_QUOTA ceiling — the same
 * budget a photo scan spends and the same one that answers 429 with
 * `daily_quota` when it runs out. It is *our* ceiling, not the model vendor's
 * account-wide limit: that one is only visible on the provider's dashboard and
 * nothing the app can call reports it.
 *
 * Staging-only on purpose. It is an operational read-out for whoever is testing
 * — publishers have no use for a quota they cannot raise, and the wall already
 * explains itself in their words when a scan hits it. Like the dev notification
 * panel, this module is swapped for a stub at resolution time in a production
 * bundle (metro.config.js), so the runtime check below is the second line of
 * defence rather than the only one.
 */
export function AiUsageBar({ publisherId }: { publisherId: string }): React.JSX.Element | null {
  const usage = useAiUsage(publisherId);

  if (!showDevTools) return null;

  return (
    <View testID="ai-usage-bar">
      <Text style={styles.sectionLabel}>AI budget (staging)</Text>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.iconWrap}>
            <Ionicons name="sparkles-outline" size={20} color={colors.accent} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Photo classification</Text>
            <Text style={styles.subtitle}>Today’s per-account limit</Text>
          </View>
          <Body usage={usage} />
        </View>
      </View>
    </View>
  );
}

/** The right-hand readout plus the bar, or whatever stands in for them. */
function Body({ usage }: { usage: ReturnType<typeof useAiUsage> }): React.JSX.Element {
  if (usage.data != null) return <Reading summary={usage.data} />;
  if (usage.loading) return <ActivityIndicator size="small" color={colors.textMuted} />;
  // Deliberately terse rather than the full ErrorState: this is a diagnostic
  // strip in Settings, and a failure to read the budget must not look like a
  // failure of anything the publisher was doing.
  return (
    <TouchableOpacity
      testID="ai-usage-retry"
      onPress={() => void usage.reload()}
      style={styles.retry}
      accessibilityLabel="Retry reading the AI budget"
    >
      <Ionicons name="refresh" size={14} color={colors.textSecondary} />
      <Text style={styles.retryText}>Unavailable</Text>
    </TouchableOpacity>
  );
}

function Reading({ summary }: { summary: AiUsageSummary }): React.JSX.Element {
  const copy = aiUsageCopy(summary);
  const tint = LEVEL_COLOR[summary.level];

  return (
    <View style={styles.reading}>
      <Text style={[styles.percent, { color: tint }]} testID="ai-usage-percent">
        {copy.headline}
      </Text>
      <View style={styles.track}>
        {/* Percent width so the fill tracks the bar at any screen size. A
            spent budget still shows a sliver, so the bar never reads as
            "nothing happening" when it means "nothing left". */}
        <View
          testID="ai-usage-fill"
          style={[
            styles.fill,
            { width: `${Math.max(2, summary.usedFraction * 100)}%`, backgroundColor: tint },
          ]}
        />
      </View>
      <Text style={styles.detail} testID="ai-usage-detail">
        {copy.detail}
      </Text>
    </View>
  );
}

const LEVEL_COLOR: Record<AiUsageLevel, string> = {
  ok: colors.accent,
  low: colors.warning,
  exhausted: colors.danger,
};

const styles = StyleSheet.create({
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.text },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  reading: { flex: 1.1, alignItems: 'flex-end' },
  percent: { ...typography.body, fontSize: 15, fontWeight: '700' },
  track: {
    width: '100%',
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  fill: { height: '100%', borderRadius: radius.pill },
  detail: { ...typography.caption, fontSize: 11, color: colors.textMuted, marginTop: spacing.xs },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: spacing.xs },
  retryText: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
});
