import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { logoSource } from '../assets';
import { useAuth } from '../context/AuthContext';
import { InviteLinkCard } from '../components/InviteLinkCard';
import { PhoneSignInScreen } from './PhoneSignInScreen';
import { ProfileSetupStep } from './onboarding/ProfileSetupStep';
import { colors, radius, spacing, typography } from '../theme/theme';

type Props = {
  /** Called when the user finishes or skips onboarding; persists the "seen" flag. */
  onDone: () => void;
};

type Step = 1 | 2 | 3 | 4;

const TOTAL_STEPS = 4;

/**
 * First-launch onboarding. Four steps:
 *   1. What Follow Me does (with a Skip escape hatch).
 *   2. Sign in (reuses the phone OTP screen).
 *   3. Set up your profile — name, optional photo, optional bio.
 *   4. Copy & share the invite link, in-place.
 * Ends on the Me page once the user taps through, or immediately on Skip.
 */
export function OnboardingScreen({ onDone }: Props): React.JSX.Element {
  const { publisherId } = useAuth();
  const [step, setStep] = useState<Step>(1);

  // Once signed in, advance past the sign-in step automatically. Covers both a
  // fresh sign-in on step 2 and the rare case of arriving already authenticated.
  useEffect(() => {
    if (step === 2 && publisherId != null) setStep(3);
  }, [step, publisherId]);

  if (step === 2) {
    return <PhoneSignInScreen />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <Image source={logoSource} style={styles.brandLogo} resizeMode="contain" />
            <Text style={styles.brandText}>Follow Me</Text>
          </View>

          <StepDots current={step} />

          {step === 1 && (
            <View style={styles.content}>
              <View style={styles.iconCircle}>
                <Ionicons name="camera" size={30} color={colors.accent} />
              </View>
              <Text style={styles.title}>Welcome to Follow Me</Text>
              <Text style={styles.body}>
                Share your photos once — your followers receive them straight to
                WhatsApp, automatically. No feed to chase, no algorithm, just the
                people who chose to follow you.
              </Text>
            </View>
          )}

          {step === 3 && publisherId != null && (
            <ProfileSetupStep publisherId={publisherId} onDone={() => setStep(4)} />
          )}

          {step === 4 && (
            <View style={styles.content}>
              <View style={styles.iconCircle}>
                <Ionicons name="person-add" size={28} color={colors.accent} />
              </View>
              <Text style={styles.title}>Share your invite link</Text>
              <Text style={styles.body}>
                Send this link to anyone you want to reach. They tap it, confirm on
                WhatsApp, and start receiving your photos — no account needed.
              </Text>
              <View style={styles.cardWrap}>
                <InviteLinkCard hint="Your personal invite link" />
              </View>
            </View>
          )}
        </ScrollView>

        {step === 1 && (
          <View style={styles.footer}>
            <TouchableOpacity style={styles.primary} onPress={() => setStep(2)} activeOpacity={0.85}>
              <Text style={styles.primaryText}>Get started</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onDone} hitSlop={8}>
              <Text style={styles.skip}>Skip</Text>
            </TouchableOpacity>
          </View>
        )}
        {step === 4 && (
          <View style={styles.footer}>
            <TouchableOpacity style={styles.primary} onPress={onDone} activeOpacity={0.85}>
              <Text style={styles.primaryText}>Go to my page</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StepDots({ current }: { current: Step }): React.JSX.Element {
  return (
    <View style={styles.dots}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <View key={i} style={[styles.dot, i + 1 === current && styles.dotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  brandLogo: { width: 44, height: 33 },
  brandText: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  dots: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xxl },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent, width: 22 },
  content: { flex: 1, justifyContent: 'center', paddingBottom: spacing.xl },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: { ...typography.largeTitle, fontSize: 30, color: colors.text, marginBottom: spacing.md },
  body: { ...typography.body, fontSize: 16, color: colors.textSecondary, lineHeight: 24 },
  cardWrap: { marginTop: spacing.xl },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg, alignItems: 'center' },
  primary: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
  skip: { color: colors.textSecondary, fontSize: 14, textDecorationLine: 'underline' },
});
