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
import { gpsFromExif } from '../../domain/services/exifGps';
import type { GpsExif } from '../../domain/services/exifGps';
import { useShareMedia } from '../hooks/useShareMedia';
import { useSubscribers } from '../hooks/useSubscribers';
import { usePublisherId } from '../context/AuthContext';
import { InviteLinkCard } from '../components/InviteLinkCard';
import { colors, radius, spacing, typography } from '../theme/theme';

type Props = {
  navigation: RootNavigationProp;
};

// Below this many active followers we nudge the publisher to invite more after a
// successful share; established publishers (at or above it) aren't nagged.
const FEW_FOLLOWERS_THRESHOLD = 3;

export function UploadScreen({ navigation }: Props): React.JSX.Element {
  const { share } = useShareMedia();
  const publisherId = usePublisherId();
  const { subscribers, loading: subscribersLoading } = useSubscribers(publisherId);
  const [pickedAssets, setPickedAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);

  const showInvitePrompt =
    !promptDismissed && !subscribersLoading && subscribers.length < FEW_FOLLOWERS_THRESHOLD;

  function handlePickMedia(): void {
    void (async (): Promise<void> => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        // EXIF carries the photos' GPS — it names the posting's place in the feed.
        exif: true,
      });
      if (!picked.canceled) {
        setPickedAssets(picked.assets);
      }
    })();
  }

  function handleShare(): void {
    void (async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const items = pickedAssets.map((asset, i) => {
          const coordinate = gpsFromExif(asset.exif as GpsExif | null | undefined);
          return {
            mediaId: `${Date.now()}-${i}`,
            localUri: asset.uri,
            filename: asset.fileName ?? asset.uri.split('/').pop() ?? `media-${i}.jpg`,
            ...(coordinate != null ? { coordinate } : {}),
          };
        });
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
        <ScrollView
          contentContainerStyle={styles.successScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.successHeader}>
            <View style={styles.successBadge}>
              <Ionicons name="checkmark" size={40} color={colors.onAccent} />
            </View>
            <Text style={styles.successTitle}>Sent!</Text>
            <Text style={styles.successSubtitle}>
              Your followers will receive the media on WhatsApp shortly.
            </Text>
          </View>

          {showInvitePrompt && (
            <View style={styles.invitePrompt}>
              <View style={styles.invitePromptHeader}>
                <Text style={styles.invitePromptTitle}>Grow your audience</Text>
                <TouchableOpacity
                  onPress={() => setPromptDismissed(true)}
                  accessibilityLabel="Dismiss"
                  hitSlop={10}
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.invitePromptBody}>
                {subscribers.length === 0
                  ? "You don't have any followers yet — share your link so people start receiving your photos."
                  : 'Reach more people — invite a few more followers to receive your photos.'}
              </Text>
              <InviteLinkCard />
              <TouchableOpacity
                style={styles.manageButton}
                onPress={() => navigation.navigate('Home', { section: 'followers' })}
              >
                <Text style={styles.manageButtonText}>Manage followers</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              setDone(false);
              setPickedAssets([]);
              setPromptDismissed(false);
              navigation.goBack();
            }}
          >
            <Text style={styles.backButtonText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
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
          Pick photos to send to your followers immediately
        </Text>
      </View>

      <TouchableOpacity style={styles.pickButton} onPress={handlePickMedia} activeOpacity={0.8}>
        <Ionicons name="add" size={28} color={colors.accent} />
        <Text style={styles.pickText}>
          {pickedAssets.length > 0
            ? `${pickedAssets.length} item${pickedAssets.length > 1 ? 's' : ''} selected — tap to change`
            : 'Select photos'}
        </Text>
      </TouchableOpacity>

      {pickedAssets.length > 0 && (
        <ScrollView horizontal style={styles.preview} showsHorizontalScrollIndicator={false}>
          {pickedAssets.map((asset, i) => (
            <Image key={i} source={{ uri: asset.uri }} style={styles.thumb} />
          ))}
        </ScrollView>
      )}

      {pickedAssets.length > 0 && (
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
  successScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xxl },
  successHeader: { alignItems: 'center' },
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
  successSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xxl, paddingHorizontal: spacing.xxl },
  invitePrompt: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  invitePromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  invitePromptTitle: { ...typography.heading, color: colors.text },
  invitePromptBody: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.lg },
  manageButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  manageButtonText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  backButton: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backButtonText: { color: colors.text, fontWeight: '600' },
});
