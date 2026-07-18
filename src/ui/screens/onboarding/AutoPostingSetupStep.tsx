import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { OnboardingHeader } from './OnboardingHeader';
import { ReviewSuggestionContent } from '../ReviewSuggestionScreen';
import {
  loadConfig,
  saveConfig,
  scheduleReminder,
  syncCandidatePhotos,
  registerPushToken,
  deviceTimezone,
} from '../../../composition/container';
import { PublisherConfig } from '../../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../../domain/entities/PublisherConfig';
import { colors, radius, spacing, typography } from '../../theme/theme';
import { confirmPhotoSync } from '../../data/photoSyncConsent';

type Props = {
  publisherId: string;
  step: number;
  totalSteps: number;
  onDone: () => void;
};

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const TIME_PRESETS = ['08:00', '12:00', '18:00', '21:00'];
const FREQ_OPTIONS: { value: Frequency; label: string }[] = [
  { value: '3days', label: '3 days' },
  { value: 'weekly', label: '1 week' },
  { value: 'biweekly', label: '2 weeks' },
  { value: 'monthly', label: '30 days' },
];

export function AutoPostingSetupStep({ publisherId, step, totalSteps, onDone }: Props): React.JSX.Element {
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [photoCount, setPhotoCount] = useState<PhotoCount>(10);
  const [askBeforePost, setAskBeforePost] = useState(true);
  const [notifyDayOfWeek, setNotifyDayOfWeek] = useState(0);
  const [notifyTime, setNotifyTime] = useState('18:00');
  const [pushToken, setPushToken] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  useEffect(() => {
    void loadConfig.execute(publisherId).then(config => {
      setFrequency(config.frequency);
      setPhotoCount(config.photosPerPost);
      setAskBeforePost(config.requireApproval);
      setNotifyDayOfWeek(config.notifyDayOfWeek);
      setNotifyTime(config.notifyTime);
      setPushToken(config.expoPushToken);
      setIsLoading(false);
    });
  }, [publisherId]);

  function buildCurrentConfig(token: string): PublisherConfig {
    return PublisherConfig.create({
      publisherId,
      frequency,
      photosPerPost: photoCount,
      requireApproval: askBeforePost,
      notifyDayOfWeek,
      notifyTime,
      timezone: deviceTimezone(),
      expoPushToken: token,
    });
  }

  function handleSave(): void {
    void (async (): Promise<void> => {
      setSaving(true);
      try {
        // Both modes rely on the server pipeline (approval mode gets its batch
        // pushed by the server too), so always register the push token and keep
        // recent photos synced to the cloud.
        const token = (await registerPushToken().catch(() => null)) ?? pushToken;
        setPushToken(token);
        const config = buildCurrentConfig(token);
        await saveConfig.execute(config);
        if (await confirmPhotoSync()) {
          await syncCandidatePhotos.execute(publisherId, config.lookbackDays).catch(() => undefined);
        }
        if (token !== '') {
          // Server owns the reminder — cancel the local one to avoid double-notifying.
          await scheduleReminder.cancel().catch(() => undefined);
        } else {
          // No push token (permissions denied / simulator) — local reminder fallback.
          await scheduleReminder.execute(config).catch(() => undefined);
        }
        onDone();
      } finally {
        setSaving(false);
      }
    })();
  }

  function handlePreview(): void {
    void (async (): Promise<void> => {
      const config = buildCurrentConfig(pushToken);
      await saveConfig.execute(config).catch(() => undefined);
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

  if (isLoading) {
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

        <Text style={styles.groupLabel}>Post every</Text>
        <View style={styles.options}>
          {FREQ_OPTIONS.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              style={[styles.option, frequency === value && styles.optionActive]}
              onPress={() => setFrequency(value)}
            >
              <Text style={[styles.optionText, frequency === value && styles.optionTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.groupLabel, styles.spacer]}>Reminder day</Text>
        <View style={styles.options}>
          {DAY_LABELS.map((label, day) => (
            <TouchableOpacity
              key={day}
              style={[styles.option, notifyDayOfWeek === day && styles.optionActive]}
              onPress={() => setNotifyDayOfWeek(day)}
            >
              <Text style={[styles.optionText, notifyDayOfWeek === day && styles.optionTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.groupLabel, styles.spacer]}>Reminder time</Text>
        <View style={styles.options}>
          {TIME_PRESETS.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.option, notifyTime === t && styles.optionActive]}
              onPress={() => setNotifyTime(t)}
            >
              <Text style={[styles.optionText, notifyTime === t && styles.optionTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.toggleRow, styles.spacer]}>
          <View style={styles.toggleText}>
            <Text style={styles.groupLabel}>Ask before posting</Text>
            <Text style={styles.hint}>
              {askBeforePost
                ? 'You review and approve each post first'
                : 'Posts go out automatically on your schedule'}
            </Text>
          </View>
          <Switch
            value={askBeforePost}
            onValueChange={setAskBeforePost}
            trackColor={{ false: colors.border, true: colors.success }}
            thumbColor={colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>

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
  groupLabel: { ...typography.caption, fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  spacer: { marginTop: spacing.lg },
  hint: { ...typography.caption, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  options: { flexDirection: 'row', gap: spacing.xs },
  option: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  optionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  optionTextActive: { color: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { flex: 1, marginRight: spacing.md },
  previewButton: {
    marginTop: spacing.xl,
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
