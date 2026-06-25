import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Switch, ScrollView, StyleSheet } from 'react-native';
import { usePublisherId } from '../../context/AuthContext';
import {
  saveConfig,
  loadConfig,
  scheduleReminder,
  syncCandidatePhotos,
  registerPushToken,
  deviceTimezone,
} from '../../../composition/container';
import { PublisherConfig } from '../../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../../domain/entities/PublisherConfig';
import { SELECTABLE_CATEGORIES } from '../../../domain/entities/PhotoClassification';
import type { PhotoCategory } from '../../../domain/entities/PhotoClassification';
import { colors, radius, spacing, typography } from '../../theme/theme';

interface Props {
  /** Bottom padding so content clears the floating nav. */
  bottomInset: number;
  /** Called after a successful save. */
  onSaved: () => void;
  /** Open the suggestion review screen to preview the batch now. */
  onPreview: () => void;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const TIME_PRESETS = ['08:00', '12:00', '18:00', '21:00'];
const LOOKBACKS: { days: number; label: string }[] = [
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '30 days' },
];
const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  selfie_with_view: 'Selfie + view',
  selfie_with_people: 'Selfie + people',
  view_only: 'View',
  food: 'Food',
  other: 'Other',
};

/** Compact auto-posting controls, rendered inside the Me-page bottom sheet. */
export function AutoPostingSection({ bottomInset, onSaved, onPreview }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [photoCount, setPhotoCount] = useState<PhotoCount>(10);
  const [askBeforePost, setAskBeforePost] = useState(true);
  const [notifyDayOfWeek, setNotifyDayOfWeek] = useState(0);
  const [notifyTime, setNotifyTime] = useState('18:00');
  const [categories, setCategories] = useState<PhotoCategory[]>([...SELECTABLE_CATEGORIES]);
  const [lookbackDays, setLookbackDays] = useState(7);
  const [pushToken, setPushToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadConfig.execute(publisherId).then(config => {
      setFrequency(config.frequency);
      setPhotoCount(config.photosPerPost);
      setAskBeforePost(config.requireApproval);
      setNotifyDayOfWeek(config.notifyDayOfWeek);
      setNotifyTime(config.notifyTime);
      setCategories(config.enabledCategories);
      setLookbackDays(config.lookbackDays);
      setPushToken(config.expoPushToken);
      setIsLoading(false);
    });
  }, [publisherId]);

  function toggleCategory(cat: PhotoCategory): void {
    setCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat],
    );
  }

  function handleSave(): void {
    void (async (): Promise<void> => {
      setSaving(true);
      try {
        // Autonomous mode: register a push token (for the empty-batch reminder).
        let token = pushToken;
        if (!askBeforePost) {
          token = (await registerPushToken()) ?? '';
          setPushToken(token);
        }

        const config = PublisherConfig.create({
          publisherId,
          frequency,
          photosPerPost: photoCount,
          requireApproval: askBeforePost,
          notifyDayOfWeek,
          notifyTime,
          enabledCategories: categories,
          lookbackDays,
          timezone: deviceTimezone(),
          expoPushToken: token,
        });
        await saveConfig.execute(config);

        if (askBeforePost) {
          // Local reminder owns the schedule; nothing leaves the device.
          await scheduleReminder.execute(config).catch(() => undefined);
        } else {
          // Server owns the schedule: cancel the local reminder and upload
          // recent photos so the cron can post them with no approval needed.
          await scheduleReminder.cancel().catch(() => undefined);
          await syncCandidatePhotos.execute(publisherId, lookbackDays).catch(() => undefined);
        }
        onSaved();
      } finally {
        setSaving(false);
      }
    })();
  }

  if (isLoading) {
    return <Text style={styles.loading}>Loading…</Text>;
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
    >
      <Text style={styles.title}>Auto-posting</Text>

      <View style={styles.group}>
        <Text style={styles.groupLabel}>Frequency</Text>
        <View style={styles.options}>
          {(['weekly', 'biweekly', 'monthly'] as Frequency[]).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.option, frequency === f && styles.optionActive]}
              onPress={() => setFrequency(f)}
            >
              <Text style={[styles.optionText, frequency === f && styles.optionTextActive]}>
                {f === 'weekly' ? 'Weekly' : f === 'biweekly' ? '2 weeks' : 'Monthly'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.groupLabel}>Reminder day</Text>
        <View style={styles.options}>
          {DAY_LABELS.map((label, day) => (
            <TouchableOpacity
              key={day}
              style={[styles.dayOption, notifyDayOfWeek === day && styles.optionActive]}
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
      </View>

      <View style={styles.group}>
        <Text style={styles.groupLabel}>Suggest photos of</Text>
        <View style={styles.wrapOptions}>
          {SELECTABLE_CATEGORIES.map(cat => {
            const active = categories.includes(cat);
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, active && styles.optionActive]}
                onPress={() => toggleCategory(cat)}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>
                  {CATEGORY_LABELS[cat]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.groupLabel}>Look back over</Text>
        <View style={styles.options}>
          {LOOKBACKS.map(({ days, label }) => (
            <TouchableOpacity
              key={days}
              style={[styles.option, lookbackDays === days && styles.optionActive]}
              onPress={() => setLookbackDays(days)}
            >
              <Text style={[styles.optionText, lookbackDays === days && styles.optionTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.groupLabel}>Photos per post</Text>
        <View style={styles.options}>
          {([5, 10, 15] as PhotoCount[]).map(n => (
            <TouchableOpacity
              key={n}
              style={[styles.option, photoCount === n && styles.optionActive]}
              onPress={() => setPhotoCount(n)}
            >
              <Text style={[styles.optionText, photoCount === n && styles.optionTextActive]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={[styles.group, styles.toggleRow]}>
        <View style={styles.toggleText}>
          <Text style={styles.groupLabel}>Ask before posting</Text>
          <Text style={styles.hint}>
            {askBeforePost
              ? 'Approve each post before it goes out'
              : 'Posts go out automatically — recent photos are uploaded so we can post even when the app is closed'}
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
        style={[styles.saveButton, saving && styles.saveButtonDisabled]}
        onPress={handleSave}
        activeOpacity={0.85}
        disabled={saving}
      >
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.previewButton} onPress={onPreview} activeOpacity={0.85}>
        <Text style={styles.previewText}>Preview suggestion now</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, gap: spacing.md },
  loading: { ...typography.caption, color: colors.textSecondary, padding: spacing.xl },
  title: { ...typography.heading, fontSize: 16, color: colors.text, marginBottom: spacing.xs },
  group: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  groupLabel: { ...typography.caption, fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  spacer: { marginTop: spacing.md },
  options: { flexDirection: 'row', gap: spacing.xs },
  wrapOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  option: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayOption: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  optionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  optionTextActive: { color: '#fff' },
  hint: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { flex: 1, marginRight: spacing.md },
  saveButton: {
    backgroundColor: colors.ink,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  previewButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewText: { color: colors.ink, fontWeight: '600', fontSize: 13 },
});
