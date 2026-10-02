import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { AiUsageLevel, AiUsageSummary } from '../../domain/entities/AiUsage';
import { aiUsageCopy, providerChainCopy } from '../../domain/services/aiUsage';
import { useAiUsage } from '../hooks/useAiUsage';
import { colors, radius, spacing, typography } from '../theme/theme';

/**
 * "How much AI have I got left", in every build.
 *
 * Two different things, shown together because only the pair is the truth:
 *
 * - The per-user count (`classify_quota`, migration 20240015) against our own
 *   optional ceiling. That ceiling is normally unset now, so this is usually a
 *   count with no denominator. It used to default to 500 and be rendered as a
 *   percentage, which made a number we invented look like the AI's real budget.
 * - What each PROVIDER says the account may still spend — read off its own
 *   response headers on every classify call and kept in `provider_limits`.
 *   This is the wall a scan actually hits.
 *
 * It used to be staging-only, on the reasoning that a publisher has no use for
 * a quota they cannot raise. That was wrong in the case that matters: the
 * provider ceilings are what stops a scan, and the free tiers are small enough
 * (Groq allows 8k tokens a minute — about eight photos — and Gemini twenty
 * requests a DAY) that hitting them is the normal experience rather than an
 * edge case. A publisher whose suggestion came back with four photos was being
 * told nothing at all about why. So it ships everywhere, and the whole chain is
 * listed rather than whichever provider happened to answer last.
 */
export function AiUsageCard({ publisherId }: { publisherId: string }): React.JSX.Element | null {
  const usage = useAiUsage(publisherId);

  return (
    <View testID="ai-usage-bar">
      <Text style={styles.sectionLabel}>AI budget</Text>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.iconWrap}>
            <Ionicons name="sparkles-outline" size={20} color={colors.accent} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Photo classification</Text>
            <Text style={styles.subtitle}>Photos you have graded today</Text>
          </View>
          <Body usage={usage} />
        </View>
        <ProviderChain summary={usage.data ?? null} />
      </View>
    </View>
  );
}

/**
 * Every provider's own ceilings, underneath our count, in the order grading
 * tries them.
 *
 * The whole chain, not one entry. Grading falls through when a provider's
 * budget is gone, so a single row showed whichever spoke LAST — the fallback —
 * and a deployment grading on Groq displayed "gemini" from the moment Groq's
 * daily tokens ran out, with nothing on screen to tell that apart from being
 * misconfigured. The first row is the one doing the grading; anything below it
 * is what catches the overflow.
 *
 * Renders nothing at all when no provider has ever been heard from. A row of
 * zeros would read as "you have none left", which is the opposite of "we have
 * not been told" — and standing in for an unknown with a plausible number is
 * the exact habit this whole panel is correcting.
 */
function ProviderChain({
  summary,
}: {
  summary: AiUsageSummary | null;
}): React.JSX.Element | null {
  const chain = providerChainCopy(summary?.providers);
  if (chain.length === 0) return null;

  return (
    <View style={styles.provider} testID="ai-usage-provider">
      {chain.map((copy, i) => (
        <View key={copy.headline} style={i > 0 ? styles.fallback : undefined}>
          <Text style={styles.providerHeadline}>
            {copy.headline}
            {i > 0 && <Text style={styles.providerLine}>  · fallback</Text>}
          </Text>
          {copy.lines.map(line => (
            <Text key={line} style={styles.providerLine}>
              {line}
            </Text>
          ))}
        </View>
      ))}
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
      {/* No bar when nothing of ours caps the count. A track filled against an
          invented denominator is what made this read as an AI budget rather
          than as a tally, so with no ceiling there is deliberately nothing to
          fill. */}
      {summary.usedFraction != null && (
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
      )}
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
  provider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
  },
  providerHeadline: { ...typography.caption, color: colors.text, fontWeight: '600' },
  // A fallback is a different fact from the leader, and reading as one list
  // is what let "gemini" pass for "what we grade on".
  fallback: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  providerLine: { ...typography.caption, color: colors.textSecondary },
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
