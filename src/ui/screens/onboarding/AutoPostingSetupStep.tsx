import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { OnboardingHeader } from './OnboardingHeader';
import { ReviewSuggestionContent } from '../ReviewSuggestionScreen';
import { AutoPostingForm } from '../sections/AutoPostingForm';
import { useAutoPostingConfig } from '../../hooks/useAutoPostingConfig';
import { saveConfig, scheduleReminder, registerPushToken } from '../../../composition/container';
import { colors, radius, spacing, typography } from '../../theme/theme';
import { confirmPhotoSync } from '../../data/photoSyncConsent';
import { runCandidateSyncQuietly } from '../../data/candidateSync';

type Props = {
  publisherId: string;
  step: number;
  totalSteps: number;
  onDone: () => void;
};

export function AutoPostingSetupStep({ publisherId, step, totalSteps, onDone }: Props): React.JSX.Element {
  // Same values, same entity, same validation as the settings section — the two
  // used to keep separate copies and drifted apart (see useAutoPostingConfig).
  const config = useAutoPostingConfig(publisherId);
  const [saving, setSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  function handleSave(): void {
    void (async (): Promise<void> => {
      setSaving(true);
      try {
        // Both modes rely on the server pipeline (approval mode gets its batch
        // pushed by the server too), so always register the push token and keep
        // recent photos synced to the cloud.
        const token = (await registerPushToken().catch(() => null)) ?? config.pushToken;
        config.setPushToken(token);
        const next = config.buildConfig(token);
        await saveConfig.execute(next);
        // Onboarding is the one place that asks for photo-upload consent. The
        // settings section deliberately never does — see persistConfig there.
        if (await confirmPhotoSync()) {
          await runCandidateSyncQuietly(publisherId, 'onboarding_sync_candidates', next.lookbackDays);
        }
        if (token !== '') {
          // Server owns the reminder — cancel the local one to avoid double-notifying.
          await scheduleReminder.cancel().catch(() => undefined);
        } else {
          // No push token (permissions denied / simulator) — local reminder fallback.
          await scheduleReminder.execute(next).catch(() => undefined);
        }
        onDone();
      } finally {
        setSaving(false);
      }
    })();
  }

  function handlePreview(): void {
    void (async (): Promise<void> => {
      await saveConfig.execute(config.buildConfig()).catch(() => undefined);
      setIsPreviewing(true);
    })();
  }

  if (isPreviewing) {
    return (
      <SafeAreaView style={styles.container}>
        <ReviewSuggestionContent onBack={() => setIsPreviewing(false)} />
      </SafeAreaView>
    );
  }

  if (config.isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.accent} style={styles.loadingIndicator} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <OnboardingHeader current={step} total={totalSteps} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Set up auto-posting</Text>
        <Text style={styles.body}>
          Follow Me scans your camera roll and picks the best shots using AI — on
          your schedule. You can tweak everything anytime in settings.
        </Text>

        {/* Categories and photos-per-post stay in settings: onboarding asks the
            fewest questions that make the schedule real. */}
        <AutoPostingForm
          variant="plain"
          frequency={config.frequency}
          notifyDayOfWeek={config.notifyDayOfWeek}
          notifyTime={config.notifyTime}
          askBeforePost={config.askBeforePost}
          onFrequency={config.setFrequency}
          onNotifyDayOfWeek={config.setNotifyDayOfWeek}
          onNotifyTime={config.setNotifyTime}
          onAskBeforePost={config.setAskBeforePost}
        />

        <TouchableOpacity
          style={styles.previewButton}
          onPress={handlePreview}
          activeOpacity={0.85}
        >
          <Text style={styles.previewText}>See AI photo suggestions now</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primary, saving && styles.disabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.primaryText}>Start auto-posting</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={onDone} hitSlop={8} disabled={saving}>
          <Text style={styles.skip}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingIndicator: { flex: 1 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  title: { ...typography.largeTitle, fontSize: 28, color: colors.text, marginBottom: spacing.sm },
  body: { ...typography.body, fontSize: 15, color: colors.textSecondary, marginBottom: spacing.xl },
  previewButton: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewText: { color: colors.ink, fontWeight: '600', fontSize: 13 },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  primary: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.5 },
  skip: { color: colors.textSecondary, fontSize: 14, textDecorationLine: 'underline' },
});
