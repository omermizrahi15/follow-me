import React, { memo } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { FREQUENCY_DAYS } from '../../../domain/entities/PublisherConfig';
import type { Frequency } from '../../../domain/entities/PublisherConfig';
import { isWeekdayCadence } from '../../../domain/services/autoPostSchedule';
import { colors, radius, spacing, typography } from '../../theme/theme';

/**
 * The auto-posting schedule: how often, which day, what time, and whether a
 * post waits for approval.
 *
 * One component for both places it appears — the settings section and the
 * onboarding step — because two copies is what let them drift. Onboarding used
 * to show a weekday picker even for the "every 3 days" cadence, which has no
 * weekday, and described approval mode differently from settings. Anything
 * genuinely settings-only (categories, photos per post) is passed as children
 * and renders between the schedule and the approval toggle, where it already
 * sat.
 */

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const TIME_PRESETS = ['08:00', '12:00', '18:00', '21:00'];
const FREQ_OPTIONS: { value: Frequency; label: string }[] = [
  { value: '3days', label: '3 days' },
  { value: 'weekly', label: '1 week' },
  { value: 'biweekly', label: '2 weeks' },
  { value: 'monthly', label: '30 days' },
];

interface Props {
  frequency: Frequency;
  notifyDayOfWeek: number;
  notifyTime: string;
  askBeforePost: boolean;
  onFrequency: (f: Frequency) => void;
  onNotifyDayOfWeek: (d: number) => void;
  onNotifyTime: (t: string) => void;
  onAskBeforePost: (v: boolean) => void;
  /**
   * `card` groups each block on its own tinted panel (the settings sheet);
   * `plain` stacks them flat on the page (the onboarding step).
   */
  variant: 'card' | 'plain';
  /** Settings-only controls, rendered between the schedule and the toggle. */
  children?: React.ReactNode;
}

function Group({ variant, children }: { variant: 'card' | 'plain'; children: React.ReactNode }): React.JSX.Element {
  return <View style={variant === 'card' ? styles.group : styles.plainGroup}>{children}</View>;
}

export const AutoPostingForm = memo(function AutoPostingForm({
  frequency, notifyDayOfWeek, notifyTime, askBeforePost,
  onFrequency, onNotifyDayOfWeek, onNotifyTime, onAskBeforePost,
  variant, children,
}: Props): React.JSX.Element {
  const lookbackDays = FREQUENCY_DAYS[frequency];

  return (
    <>
      {/* Frequency (= lookback window) */}
      <Group variant={variant}>
        <Text style={styles.groupLabel}>Post every</Text>
        <View style={styles.options}>
          {FREQ_OPTIONS.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              testID={`auto-freq-${value}`}
              style={[styles.option, frequency === value && styles.optionActive]}
              onPress={() => onFrequency(value)}
            >
              <Text style={[styles.optionText, frequency === value && styles.optionTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Group>

      {/* Schedule. Weekly cadences pick a weekday; day-count cadences (every
          3/30 days) have no natural weekday — the next slot is shown instead. */}
      <Group variant={variant}>
        <Text style={styles.groupLabel}>Reminder day</Text>
        {isWeekdayCadence(lookbackDays) ? (
          <View style={styles.options}>
            {DAY_LABELS.map((label, day) => (
              <TouchableOpacity
                key={day}
                testID={`auto-day-${day}`}
                style={[styles.option, notifyDayOfWeek === day && styles.optionActive]}
                onPress={() => onNotifyDayOfWeek(day)}
              >
                <Text style={[styles.optionText, notifyDayOfWeek === day && styles.optionTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={styles.intervalNote} testID="auto-interval-note">
            Every {lookbackDays} days there’s no fixed weekday — the next one lands by{' '}
            {new Date(Date.now() + lookbackDays * 24 * 60 * 60 * 1000).toLocaleDateString([], {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
            , then every {lookbackDays} days after each post.
          </Text>
        )}
        <Text style={[styles.groupLabel, styles.spacer]}>Reminder time</Text>
        <View style={styles.options}>
          {TIME_PRESETS.map(t => (
            <TouchableOpacity
              key={t}
              testID={`auto-time-${t}`}
              style={[styles.option, notifyTime === t && styles.optionActive]}
              onPress={() => onNotifyTime(t)}
            >
              <Text style={[styles.optionText, notifyTime === t && styles.optionTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Group>

      {children}

      {/* Approval toggle */}
      <View style={[variant === 'card' ? styles.group : styles.plainGroup, styles.toggleRow]}>
        <View style={styles.toggleText}>
          <Text style={styles.groupLabel}>Ask before posting</Text>
          <Text style={styles.hint}>
            {askBeforePost
              ? 'Approve each post before it goes out'
              : 'Posts go out automatically — recent photos are uploaded so we can post even when the app is closed'}
          </Text>
        </View>
        <Switch
          testID="auto-approval-toggle"
          value={askBeforePost}
          onValueChange={onAskBeforePost}
          trackColor={{ false: colors.border, true: colors.success }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.border}
        />
      </View>
    </>
  );
});

/**
 * Exported because the settings section renders its own groups (categories,
 * photos per post) beside these and has to match them exactly — one stylesheet
 * rather than a second copy of the same numbers.
 */
export const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    // The dragged category row lifts out of its group.
    overflow: 'visible',
  },
  plainGroup: { marginBottom: spacing.lg },
  groupLabel: {
    ...typography.caption,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  spacer: { marginTop: spacing.md },
  hint: { ...typography.caption, fontSize: 11, color: colors.textMuted, marginBottom: spacing.sm },
  intervalNote: { ...typography.caption, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
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
});
