import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Switch, ScrollView, StyleSheet } from 'react-native';
import { usePublisherId } from '../../context/AuthContext';
import { saveConfig, loadConfig } from '../../../composition/container';
import { PublisherConfig } from '../../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../../domain/entities/PublisherConfig';
import { colors, radius, spacing, typography } from '../../theme/theme';

interface Props {
  /** Bottom padding so content clears the floating nav. */
  bottomInset: number;
  /** Called after a successful save. */
  onSaved: () => void;
}

/** Compact auto-posting controls, rendered inside the Me-page bottom sheet. */
export function AutoPostingSection({ bottomInset, onSaved }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [photoCount, setPhotoCount] = useState<PhotoCount>(10);
  const [askBeforePost, setAskBeforePost] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadConfig.execute(publisherId).then(config => {
      setFrequency(config.frequency);
      setPhotoCount(config.photosPerPost);
      setAskBeforePost(config.requireApproval);
      setIsLoading(false);
    });
  }, [publisherId]);

  function handleSave(): void {
    void saveConfig.execute(
      PublisherConfig.create({
        publisherId,
        frequency,
        photosPerPost: photoCount,
        requireApproval: askBeforePost,
      }),
    ).then(onSaved);
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
            {askBeforePost ? 'Approve each post before it goes out' : 'Posts go out automatically'}
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

      <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.85}>
        <Text style={styles.saveText}>Save</Text>
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
  saveText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
