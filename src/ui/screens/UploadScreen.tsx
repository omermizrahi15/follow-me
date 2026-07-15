import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { RootNavigationProp } from '../navigation/types';
import { coordinatesForPickedAssets } from '../../domain/services/pickedAssetCoordinates';
import { mediaLibraryAssetLocation } from '../../infrastructure/media/assetLocation';
import type { Coordinate } from '../../domain/interfaces';
import { resolvePlaceForCoordinates } from '../../composition/container';
import { useShareMedia } from '../hooks/useShareMedia';
import { useSubscribers } from '../hooks/useSubscribers';
import { useKeyboardBottomPadding } from '../hooks/useKeyboardBottomPadding';
import { usePublisherId } from '../context/AuthContext';
import { InviteLinkCard } from '../components/InviteLinkCard';
import { SongPickerSheet } from '../components/SongPickerSheet';
import type { Song } from '../../domain/entities/Song';
import { colors, radius, spacing, typography } from '../theme/theme';

type Props = {
  navigation: RootNavigationProp;
};

// Below this many active followers we nudge the publisher to invite more after a
// successful share; established publishers (at or above it) aren't nagged.
const FEW_FOLLOWERS_THRESHOLD = 3;

export function UploadScreen({ navigation }: Props): React.JSX.Element {
  const { share, progress: shareProgress } = useShareMedia();
  // Exact pixel size for the 3-column grid — %-width + aspectRatio collapses
  // inside the ScrollView chain on iOS.
  const { width: windowWidth } = useWindowDimensions();
  const tileSize = Math.floor((windowWidth - spacing.xl * 2 - spacing.sm * 2) / 3);
  // KeyboardAvoidingView under-pads inside this screen's pageSheet modal, so
  // the footer pads itself by the keyboard's height instead.
  const keyboardPadding = useKeyboardBottomPadding();
  const publisherId = usePublisherId();
  const { subscribers, loading: subscribersLoading } = useSubscribers(publisherId);
  const [pickedAssets, setPickedAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptDismissed, setPromptDismissed] = useState(false);
  // Posting place — auto-resolved from the picked photos' EXIF GPS, editable.
  const [place, setPlace] = useState('');
  const [placeLoading, setPlaceLoading] = useState(false);
  const placeEditedRef = useRef(false);
  // Posting soundtrack — optional, picked via the AI/search sheet (issue #54).
  const [song, setSong] = useState<Song | null>(null);
  const [songPickerOpen, setSongPickerOpen] = useState(false);

  const showInvitePrompt =
    !promptDismissed && !subscribersLoading && subscribers.length < FEW_FOLLOWERS_THRESHOLD;

  // Resolve the place whenever the selection changes; a manual edit wins.
  useEffect(() => {
    if (pickedAssets.length === 0) {
      if (!placeEditedRef.current) setPlace('');
      return;
    }
    const run = { cancelled: false };
    void (async (): Promise<void> => {
      setPlaceLoading(true);
      try {
        // EXIF first, then a photo-library lookup — iOS's picker strips GPS
        // EXIF, so without the fallback most iOS batches resolve no place.
        const coordinates = (
          await coordinatesForPickedAssets(pickedAssets, mediaLibraryAssetLocation)
        ).filter((c): c is Coordinate => c != null);
        // Checked via a function call so lint doesn't flow-narrow across awaits.
        const isStale = (): boolean => run.cancelled || placeEditedRef.current;
        if (isStale()) return;
        const resolved = coordinates.length > 0 ? await resolvePlaceForCoordinates(coordinates) : null;
        if (!isStale()) setPlace(resolved ?? '');
      } finally {
        if (!run.cancelled) setPlaceLoading(false);
      }
    })();
    return () => { run.cancelled = true; };
  }, [pickedAssets]);

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
        // Same EXIF-then-library resolution as the place preview (cached, so
        // these lookups were already paid for by the preview effect).
        const coordinates = await coordinatesForPickedAssets(pickedAssets, mediaLibraryAssetLocation);
        const items = pickedAssets.map((asset, i) => {
          const coordinate = coordinates[i];
          return {
            mediaId: `${Date.now()}-${i}`,
            localUri: asset.uri,
            filename: asset.fileName ?? asset.uri.split('/').pop() ?? `media-${i}.jpg`,
            ...(coordinate != null ? { coordinate } : {}),
          };
        });
        // The user's explicit edit always wins (clearing = post with no place).
        // An untouched empty/loading field falls back to GPS auto-resolution.
        const location = placeEditedRef.current
          ? place
          : placeLoading || place === ''
          ? undefined
          : place;
        await share(items, publisherId, location, song ?? undefined);
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
              Your followers will receive the photos on WhatsApp shortly.
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
              setSong(null);
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
      <View style={styles.flex}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>New post</Text>
            <TouchableOpacity
              testID="upload-close"
              onPress={() => navigation.goBack()}
              accessibilityLabel="Close"
              hitSlop={8}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>
            Pick photos to send to your followers immediately
          </Text>
        </View>

        {pickedAssets.length === 0 ? (
          /* Empty state — one big centered picker target. */
          <View style={styles.emptyState}>
            <TouchableOpacity testID="upload-pick-photos" style={styles.pickButton} onPress={handlePickMedia} activeOpacity={0.8}>
              <View style={styles.pickIcon}>
                <Ionicons name="images-outline" size={30} color={colors.accent} />
              </View>
              <Text style={styles.pickTitle}>Select photos</Text>
              <Text style={styles.pickHint}>Choose from your library</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
              {pickedAssets.map((asset, i) => (
                <Image
                  key={`${asset.assetId ?? asset.uri}-${i}`}
                  source={{ uri: asset.uri }}
                  style={[styles.gridThumb, { width: tileSize, height: tileSize }]}
                />
              ))}
              <TouchableOpacity
                style={[styles.addTile, { width: tileSize, height: tileSize }]}
                onPress={handlePickMedia}
                activeOpacity={0.7}
                accessibilityLabel="Change selection"
              >
                <View style={styles.addTileInner}>
                  <Ionicons name="add" size={24} color={colors.accent} />
                  <Text style={styles.addTileText}>Change</Text>
                </View>
              </TouchableOpacity>
            </ScrollView>

            <View style={[styles.footer, keyboardPadding > 0 && { paddingBottom: keyboardPadding }]}>
              {error != null && <Text style={styles.errorNote}>{error}</Text>}
              <View style={styles.placeRow}>
                <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                <TextInput
                  style={styles.placeInput}
                  value={place}
                  onChangeText={text => {
                    placeEditedRef.current = true;
                    setPlace(text);
                  }}
                  placeholder={placeLoading ? 'Finding the place…' : 'Add a place (optional)'}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  accessibilityLabel="Posting place"
                />
                {placeLoading ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : place !== '' ? (
                  <TouchableOpacity
                    onPress={() => {
                      placeEditedRef.current = true;
                      setPlace('');
                    }}
                    hitSlop={8}
                    accessibilityLabel="Clear place"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {song == null ? (
                <TouchableOpacity
                  testID="upload-add-song"
                  style={styles.songRow}
                  onPress={() => setSongPickerOpen(true)}
                  accessibilityLabel="Add a song"
                >
                  <Ionicons name="musical-notes-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.songPlaceholder}>Add a song (optional)</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ) : (
                <View style={styles.songRow}>
                  {song.artworkUrl != null ? (
                    <Image source={{ uri: song.artworkUrl }} style={styles.songArt} />
                  ) : (
                    <Ionicons name="musical-notes" size={16} color={colors.accent} />
                  )}
                  <TouchableOpacity
                    style={styles.songNames}
                    onPress={() => setSongPickerOpen(true)}
                    accessibilityLabel="Change song"
                  >
                    <Text style={styles.songText} numberOfLines={1}>
                      {song.title} <Text style={styles.songArtistText}>— {song.artist}</Text>
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setSong(null)}
                    hitSlop={8}
                    accessibilityLabel="Remove song"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}
              <Text style={styles.followerNote}>
                Will be sent to all your active followers via WhatsApp
              </Text>
              <TouchableOpacity
                style={[styles.shareButton, loading && styles.disabled]}
                onPress={handleShare}
                disabled={loading}
              >
                {loading ? (
                  <View style={styles.progressRow}>
                    <ActivityIndicator color={colors.onAccent} />
                    <Text style={styles.shareText}>
                      {shareProgress?.stage === 'uploading'
                        ? `Uploading ${Math.min(shareProgress.done + 1, shareProgress.total)}/${shareProgress.total}…`
                        : shareProgress?.stage === 'notifying'
                        ? 'Sending to followers…'
                        : 'Posting…'}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.shareText}>
                    Send {pickedAssets.length} photo{pickedAssets.length === 1 ? '' : 's'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      <SongPickerSheet
        visible={songPickerOpen}
        place={placeLoading ? undefined : place || undefined}
        photoUris={pickedAssets.map(a => a.uri)}
        onSelect={s => {
          setSong(s);
          setSongPickerOpen(false);
        }}
        onClose={() => setSongPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // The modal IS a card — one white surface edge to edge, so the sheet's
  // rounded corners, the header and the content all read as a single layer.
  // NOTE: horizontal padding lives on the inner view, NOT the SafeAreaView —
  // RN's SafeAreaView overwrites style padding with its computed insets
  // (0 on the sides), silently killing it.
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, paddingHorizontal: spacing.xl },
  header: { paddingTop: spacing.xl, paddingBottom: spacing.lg, alignItems: 'center' },
  headerTop: { width: '100%', alignItems: 'center', justifyContent: 'center', minHeight: 34 },
  closeButton: {
    position: 'absolute',
    right: 0,
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.title, fontSize: 17, color: colors.text, textAlign: 'center' },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
  // Empty state
  emptyState: { flex: 1, justifyContent: 'center', paddingBottom: spacing.xxl * 2 },
  pickButton: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    paddingVertical: spacing.xxl * 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pickIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  pickTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  pickHint: { ...typography.caption, color: colors.textMuted },
  // Selection grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  gridThumb: {
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  addTile: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  // Absolute fill guarantees dead-center content regardless of how the
  // touchable lays out its children.
  addTileInner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTileText: { ...typography.caption, fontSize: 11, lineHeight: 14, color: colors.accent, fontWeight: '600', textAlign: 'center' },
  // Footer
  footer: { paddingVertical: spacing.md },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  placeInput: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 14,
    color: colors.text,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  songPlaceholder: { flex: 1, fontSize: 14, color: colors.textMuted },
  songArt: { width: 24, height: 24, borderRadius: radius.sm, backgroundColor: colors.surface },
  songNames: { flex: 1 },
  songText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  songArtistText: { color: colors.textSecondary, fontWeight: '400' },
  errorNote: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm },
  followerNote: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: spacing.md },
  shareButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disabled: { opacity: 0.5 },
  shareText: { color: colors.onAccent, fontWeight: '600', fontSize: 15 },
  successScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
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
