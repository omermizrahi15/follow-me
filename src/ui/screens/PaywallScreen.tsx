import React from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth, usePublisherId } from '../context/AuthContext';
import { usePlus } from '../hooks/usePlus';
import { openLegalDocument, PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../legal';
import { bestValuePackageId, packageTitle, savingsPercent, trialLabel } from '../../domain/services/paywall';
import { PLANS } from '../../domain/services/plans';
import { colors, radius, spacing, typography } from '../theme/theme';

const PERKS = [
  `Up to ${PLANS.plus.whatsappMessagesPerMonth.toLocaleString()} WhatsApp messages a month`,
  `AI photo picks for up to ${PLANS.plus.aiPhotosPerDay} photos a day`,
  `Up to ${PLANS.plus.followers} followers`,
  'Your whole trip, shared with the people who matter',
];

/**
 * The Plus paywall (issue #252). Shown from Settings, and as the ONLY screen
 * when the app requires Plus (`locked`), in which case there is no back button
 * — just purchase, restore and sign out.
 *
 * Apple requires, and this carries: store-localised prices, the trial length,
 * a Restore button, auto-renew wording, and links to the terms and privacy policy.
 */
export function PaywallScreen({ locked = false }: { locked?: boolean }): React.JSX.Element {
  const publisherId = usePublisherId();
  const { signOut } = useAuth();
  const plus = usePlus(publisherId);
  const packages = plus.view?.offering?.packages ?? [];
  const best = bestValuePackageId(packages);
  const monthly = packages.find(p => p.period === 'monthly');
  const yearly = packages.find(p => p.period === 'yearly');
  const saving = monthly != null && yearly != null ? savingsPercent(monthly, yearly) : null;
  const trial = trialLabel(packages.find(p => p.trialDays != null)?.trialDays ?? null);
  const busy = plus.busy != null;

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Follow Me Plus" showBack={!locked} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.headline}>Share your trip, effortlessly</Text>
        {PERKS.map(perk => (
          <View key={perk} style={styles.perk}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.perkText}>{perk}</Text>
          </View>
        ))}

        {plus.loading ? (
          <ActivityIndicator color={colors.accent} style={styles.gap} />
        ) : plus.view?.active ? (
          <View style={[styles.notice, styles.gap]}>
            <Text style={styles.noticeText}>You have Follow Me Plus. Thank you!</Text>
          </View>
        ) : plus.view?.available === false ? (
          <View style={[styles.notice, styles.gap]}>
            <Text style={styles.noticeText}>Purchases are not available in this build.</Text>
          </View>
        ) : packages.length === 0 ? (
          <View style={[styles.notice, styles.gap]}>
            <Text style={styles.noticeText}>Plans could not be loaded. Check your connection and try again.</Text>
            <TouchableOpacity testID="paywall-retry" onPress={() => void plus.reload()}>
              <Text style={styles.link}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.gap}>
            {trial != null && <Text style={styles.trial}>{trial}, then billed by Apple</Text>}
            {packages.map(pkg => (
              <TouchableOpacity
                key={pkg.id}
                testID={`paywall-buy-${pkg.period}`}
                style={[styles.plan, pkg.id === best && styles.planBest]}
                disabled={busy}
                onPress={() => void plus.purchase(pkg.id)}
                activeOpacity={0.8}
              >
                <View style={styles.planText}>
                  <Text style={styles.planTitle}>{packageTitle(pkg.period)}</Text>
                  {pkg.id === best && saving != null && <Text style={styles.badge}>Save {saving}%</Text>}
                </View>
                <Text style={styles.planPrice}>
                  {plus.busy === 'purchasing' ? '…' : `${pkg.priceLabel}/${pkg.period === 'yearly' ? 'year' : 'month'}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {plus.notice != null && <Text style={styles.error}>{plus.notice}</Text>}

        {plus.view?.available !== false && (
          <TouchableOpacity testID="paywall-restore" onPress={() => void plus.restore()} disabled={busy} style={styles.center}>
            <Text style={styles.link}>{plus.busy === 'restoring' ? 'Restoring…' : 'Restore purchases'}</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.fine}>
          Payment is charged to your Apple ID. The subscription renews automatically unless cancelled at least 24
          hours before the end of the period. Manage or cancel any time in your Apple ID settings.
        </Text>
        <View style={styles.legal}>
          <TouchableOpacity onPress={() => void openLegalDocument('Terms of Service', TERMS_OF_SERVICE_URL)}>
            <Text style={styles.link}>Terms</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void openLegalDocument('Privacy Policy', PRIVACY_POLICY_URL)}>
            <Text style={styles.link}>Privacy</Text>
          </TouchableOpacity>
        </View>

        {locked && (
          <TouchableOpacity testID="paywall-sign-out" onPress={() => void signOut()} style={styles.center}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  headline: { ...typography.title, color: colors.text, marginVertical: spacing.lg },
  perk: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  perkText: { ...typography.body, color: colors.text, flex: 1 },
  gap: { marginTop: spacing.xl },
  trial: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm, textAlign: 'center' },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  planBest: { borderColor: colors.accent, borderWidth: 2 },
  planText: { flex: 1 },
  planTitle: { ...typography.heading, color: colors.text },
  badge: { ...typography.caption, color: colors.success, marginTop: 2, fontWeight: '600' },
  planPrice: { ...typography.heading, color: colors.accent },
  notice: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  noticeText: { ...typography.body, color: colors.text },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.md, textAlign: 'center' },
  center: { alignItems: 'center', paddingVertical: spacing.lg },
  link: { ...typography.button, color: colors.accent },
  fine: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  legal: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, marginTop: spacing.md },
  signOut: { color: colors.danger, fontWeight: '600', fontSize: 15 },
});
