import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { RootStackParamList } from '../navigation/types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useShareMedia } from '../hooks/useShareMedia';
import { useAuth } from '../context/AuthContext';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

export function UploadScreen({ navigation }: Props): React.JSX.Element {
  const { share } = useShareMedia();
  const { publisherId } = useAuth();
  const [pickedUris, setPickedUris] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePickMedia(): void {
    void (async (): Promise<void> => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: true,
        quality: 0.8,
      });
      if (!picked.canceled) {
        setPickedUris(picked.assets.map(a => a.uri));
      }
    })();
  }

  function handleShare(): void {
    void (async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const items = pickedUris.map((uri, i) => ({
          mediaId: `${Date.now()}-${i}`,
          localUri: uri,
          filename: uri.split('/').pop() ?? `media-${i}.jpg`,
        }));
        await share(items, publisherId ?? '');
        setDone(true);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setLoading(false);
      }
    })();
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>Sent!</Text>
          <Text style={styles.successSubtitle}>
            Your followers will receive the media on WhatsApp shortly.
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              setDone(false);
              setPickedUris([]);
              navigation.goBack();
            }}
          >
            <Text style={styles.backButtonText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Share media now</Text>
        <Text style={styles.subtitle}>
          Pick photos or videos to send to your followers immediately
        </Text>
      </View>

      <TouchableOpacity style={styles.pickButton} onPress={handlePickMedia}>
        <Text style={styles.pickIcon}>+</Text>
        <Text style={styles.pickText}>
          {pickedUris.length > 0
            ? `${pickedUris.length} item${pickedUris.length > 1 ? 's' : ''} selected — tap to change`
            : 'Select photos or videos'}
        </Text>
      </TouchableOpacity>

      {pickedUris.length > 0 && (
        <ScrollView horizontal style={styles.preview} showsHorizontalScrollIndicator={false}>
          {pickedUris.map((uri, i) => (
            <Image key={i} source={{ uri }} style={styles.thumb} />
          ))}
        </ScrollView>
      )}

      {pickedUris.length > 0 && (
        <View style={styles.footer}>
          {error != null && <Text style={styles.errorNote}>{error}</Text>}
          <Text style={styles.followerNote}>
            Will be sent to all your active followers via WhatsApp
          </Text>
          <TouchableOpacity
            style={[styles.shareButton, loading && styles.disabled]}
            onPress={handleShare}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.shareText}>Send to followers</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d', paddingHorizontal: 24 },
  header: { paddingTop: 24, paddingBottom: 32 },
  back: { color: '#555', fontSize: 14, marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#555', marginTop: 6 },
  pickButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderStyle: 'dashed',
    padding: 32,
    alignItems: 'center',
  },
  pickIcon: { fontSize: 28, color: '#444', marginBottom: 8 },
  pickText: { color: '#555', fontSize: 14, textAlign: 'center' },
  preview: { marginTop: 16, flexGrow: 0 },
  thumb: { width: 80, height: 80, borderRadius: 8, marginRight: 8 },
  footer: { position: 'absolute', bottom: 40, left: 24, right: 24 },
  errorNote: { color: '#f87171', fontSize: 13, textAlign: 'center', marginBottom: 8 },
  followerNote: { color: '#444', fontSize: 12, textAlign: 'center', marginBottom: 12 },
  shareButton: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  shareText: { color: '#000', fontWeight: '600', fontSize: 15 },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  successIcon: { fontSize: 48, color: '#4ade80', marginBottom: 16 },
  successTitle: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 8 },
  successSubtitle: { fontSize: 14, color: '#555', textAlign: 'center', marginBottom: 40, paddingHorizontal: 32 },
  backButton: { backgroundColor: '#1a1a1a', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 },
  backButtonText: { color: '#fff', fontWeight: '600' },
});