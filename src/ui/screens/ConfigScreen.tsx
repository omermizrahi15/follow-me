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
import type { RootStackParamList } from '../navigation/types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePublisherId } from '../context/AuthContext';
import { saveConfig, loadConfig } from '../../composition/container';
import { PublisherConfig } from '../../domain/entities/PublisherConfig';
import type { Frequency, PhotoCount } from '../../domain/entities/PublisherConfig';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

export function ConfigScreen({ navigation }: Props): React.JSX.Element {
  const publisherId = usePublisherId();
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [photoCount, setPhotoCount] = useState<PhotoCount>(10);
  const [askBeforePost, setAskBeforePost] = useState(true);
  const [saved, setSaved] = useState(false);
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
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
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
              trackColor={{ false: '#2a2a2a', true: '#fff' }}
              thumbColor={askBeforePost ? '#000' : '#555'}
            />
          </View>
        </View>

        {/* Save */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveText}>
            {saved ? '✓ Saved' : 'Save settings'}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d', paddingHorizontal: 24 },
  header: { paddingTop: 24, paddingBottom: 32 },
  back: { color: '#555', fontSize: 14, marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#555', marginTop: 6 },
  loadingText: { color: '#555', fontSize: 14, padding: 24 },
  section: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 12 },
  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  optionSmall: { flex: 0, paddingHorizontal: 20 },
  optionActive: { backgroundColor: '#fff', borderColor: '#fff' },
  optionText: { color: '#666', fontSize: 13, fontWeight: '500', textAlign: 'center' },
  optionTextActive: { color: '#000' },
  hint: { color: '#444', fontSize: 12, marginTop: 10, lineHeight: 18 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { flex: 1, marginRight: 16 },
  saveButton: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  saveText: { color: '#000', fontWeight: '600', fontSize: 15 },
});
