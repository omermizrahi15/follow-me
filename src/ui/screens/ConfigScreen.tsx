import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import type { TabNavigationProp } from '../navigation/types';
import { usePublisherId } from '../context/AuthContext';
import { saveConfig, loadConfig } from '../../composition/container';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../domain/entities/PublisherConfig';
import { colors, radius, spacing, typography } from '../theme/theme';

type Props = {
  navigation: TabNavigationProp;
};

export function ConfigScreen({ navigation }: Props): React.JSX.Element {
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
    ).then(() => {
      navigation.navigate('Home');
    });
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Auto-posting settings</Text>
          <Text style={styles.subtitle}>
            Configure how and when photos are shared with your followers
          </Text>
        </View>

        {/* Frequency */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Posting frequency</Text>
          <View style={styles.options}>
            {(['weekly', 'biweekly', 'monthly'] as Frequency[]).map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.option, frequency === f && styles.optionActive]}
                onPress={() => setFrequency(f)}
              >
                <Text style={[styles.optionText, frequency === f && styles.optionTextActive]}>
                  {f === 'weekly' ? 'Every week' : f === 'biweekly' ? 'Every 2 weeks' : 'Every month'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Photo count */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos per post</Text>
          <View style={styles.options}>
            {([5, 10, 15] as PhotoCount[]).map(n => (
              <TouchableOpacity
                key={n}
                style={[styles.option, styles.optionSmall, photoCount === n && styles.optionActive]}
                onPress={() => setPhotoCount(n)}
              >
                <Text style={[styles.optionText, photoCount === n && styles.optionTextActive]}>
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>
            The {photoCount} most recent photo{photoCount > 1 ? 's' : ''} from your library will be selected automatically
          </Text>
        </View>

        {/* Ask before posting */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.sectionTitle}>Ask before posting</Text>
              <Text style={styles.hint}>
                {askBeforePost
                  ? 'You\'ll get a notification to approve before each post goes out'
                  : 'Photos will be sent automatically without confirmation'}
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
        </View>

        {/* Save */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveText}>Save settings</Text>
        </TouchableOpacity>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl },
  scroll: { paddingBottom: 120 },
  header: { paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  loadingText: { color: colors.textSecondary, fontSize: 14, padding: spacing.xl },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { ...typography.heading, fontSize: 15, color: colors.text, marginBottom: spacing.md },
  options: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionSmall: { flex: 0, paddingHorizontal: spacing.xl },
  optionActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500', textAlign: 'center' },
  optionTextActive: { color: colors.onAccent },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, lineHeight: 18 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { flex: 1, marginRight: spacing.lg },
  saveButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  saveText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
});
