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
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { RootNavigationProp } from '../navigation/types';
import { useShareMedia } from '../hooks/useShareMedia';
import { usePublisherId } from '../context/AuthContext';
import { colors, radius, spacing, typography } from '../theme/theme';

type Props = {
  navigation: RootNavigationProp;
};

export function UploadScreen({ navigation }: Props): React.JSX.Element {
  const { share } = useShareMedia();
  const publisherId = usePublisherId();
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
        await share(items, publisherId);
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
          <View style={styles.successBadge}>
            <Ionicons name="checkmark" size={40} color={colors.onAccent} />
          </View>
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
            <Text style={styles.backButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>New post</Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            accessibilityLabel="Close"
            hitSlop={8}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>
          Pick photos or videos to send to your followers immediately
        </Text>
      </View>

      <TouchableOpacity style={styles.pickButton} onPress={handlePickMedia} activeOpacity={0.8}>
        <Ionicons name="add" size={28} color={colors.accent} />
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
              ? <ActivityIndicator color={colors.onAccent} />
              : <Text style={styles.shareText}>Send to followers</Text>
            }
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl },
  header: { paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  pickButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  preview: { marginTop: spacing.lg, flexGrow: 0 },
  thumb: { width: 80, height: 80, borderRadius: radius.sm, marginRight: spacing.sm },
  footer: { position: 'absolute', bottom: 120, left: spacing.xl, right: spacing.xl },
  errorNote: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm },
  followerNote: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: spacing.md },
  shareButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  shareText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  successBadge: {
    width: 80,
    height: 80,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  successTitle: { ...typography.title, fontSize: 28, color: colors.text, marginBottom: spacing.sm },
  successSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginBottom: 40, paddingHorizontal: spacing.xxl },
  backButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backButtonText: { color: colors.text, fontWeight: '600' },
});
