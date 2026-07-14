import React from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Song } from '../../domain/entities/Song';
import { useSongPicker } from '../hooks/useSongPicker';
import { usePreviewPlayer } from '../hooks/usePreviewPlayer';
import { colors, radius, spacing, typography } from '../theme/theme';

interface Props {
  visible: boolean;
  /** Context the AI suggestion uses — the post's place and its photos. */
  place?: string | undefined;
  photoUris: string[];
  onSelect: (song: Song) => void;
  onClose: () => void;
}

/** One song row: artwork, names, optional preview play, tap to choose. */
function SongRow({
  song,
  playing,
  onTogglePreview,
  onSelect,
}: {
  song: Song;
  playing: boolean;
  onTogglePreview: () => void;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.songRow} onPress={onSelect} activeOpacity={0.7}>
      {song.artworkUrl != null ? (
        <Image source={{ uri: song.artworkUrl }} style={styles.songArt} />
      ) : (
        <View style={[styles.songArt, styles.songArtFallback]}>
          <Ionicons name="musical-notes" size={16} color={colors.accent} />
        </View>
      )}
      <View style={styles.songTitles}>
        <Text style={styles.songTitle} numberOfLines={1}>{song.title}</Text>
        <Text style={styles.songArtist} numberOfLines={1}>{song.artist}</Text>
      </View>
      {song.previewUrl != null && (
        <TouchableOpacity
          onPress={onTogglePreview}
          hitSlop={8}
          accessibilityLabel={playing ? `Pause ${song.title} preview` : `Play ${song.title} preview`}
          style={styles.previewButton}
        >
          <Ionicons name={playing ? 'pause' : 'play'} size={16} color={colors.accent} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

/**
 * The "add a song" sheet (issue #54): an AI pick that has seen the post's
 * photos — accept it, reroll it, or ignore it and search the catalog manually.
 * Every row can play its 30s preview before committing.
 */
export function SongPickerSheet({ visible, place, photoUris, onSelect, onClose }: Props): React.JSX.Element {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Remount the content per open so suggestions/search/playback start fresh. */}
      {visible && <SheetContent place={place} photoUris={photoUris} onSelect={onSelect} onClose={onClose} />}
    </Modal>
  );
}

function SheetContent({ place, photoUris, onSelect, onClose }: Omit<Props, 'visible'>): React.JSX.Element {
  const picker = useSongPicker({
    ...(place != null && place !== '' ? { place } : {}),
    photoCount: photoUris.length,
    photoUris,
  });
  const player = usePreviewPlayer();

  function choose(song: Song): void {
    player.stop();
    onSelect(song);
  }

  const suggestion = picker.suggestion;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Add a song</Text>
        <TouchableOpacity
          testID="song-picker-close"
          onPress={() => { player.stop(); onClose(); }}
          accessibilityLabel="Close song picker"
          hitSlop={8}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {picker.suggestionAvailable && (
          <View style={styles.suggestionCard}>
            <View style={styles.suggestionHeader}>
              <Ionicons name="sparkles" size={14} color={colors.accent} />
              <Text style={styles.suggestionLabel}>Suggested for these photos</Text>
            </View>
            {picker.suggestionLoading || suggestion == null ? (
              <View style={styles.suggestionLoading}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.suggestionLoadingText}>Listening to your photos…</Text>
              </View>
            ) : (
              <>
                <SongRow
                  song={suggestion}
                  playing={suggestion.previewUrl != null && player.playingUrl === suggestion.previewUrl}
                  onTogglePreview={() => suggestion.previewUrl != null && player.toggle(suggestion.previewUrl)}
                  onSelect={() => choose(suggestion)}
                />
                <View style={styles.suggestionActions}>
                  <TouchableOpacity style={styles.useButton} onPress={() => choose(suggestion)}>
                    <Text style={styles.useButtonText}>Use this song</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.anotherButton}
                    onPress={() => { player.stop(); picker.nextSuggestion(); }}
                    accessibilityLabel="Try another suggestion"
                  >
                    <Ionicons name="refresh" size={14} color={colors.text} />
                    <Text style={styles.anotherButtonText}>Try another</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        <Text style={styles.searchLabel}>
          {picker.suggestionAvailable ? 'Or pick your own' : 'Search for a song'}
        </Text>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={picker.searchTerm}
            onChangeText={picker.setSearchTerm}
            placeholder="Song or artist"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search songs"
          />
          {picker.searching && <ActivityIndicator size="small" color={colors.accent} />}
        </View>

        {picker.searchResults.map(song => (
          <SongRow
            key={`${song.title}-${song.artist}-${song.previewUrl ?? ''}`}
            song={song}
            playing={song.previewUrl != null && player.playingUrl === song.previewUrl}
            onTogglePreview={() => song.previewUrl != null && player.toggle(song.previewUrl)}
            onSelect={() => choose(song)}
          />
        ))}
        {picker.searchTerm.trim() !== '' && !picker.searching && picker.searchResults.length === 0 && (
          <Text style={styles.noResults}>No songs found — try another spelling</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    minHeight: 34,
  },
  title: { ...typography.title, fontSize: 17, color: colors.text },
  closeButton: {
    position: 'absolute',
    right: spacing.xl,
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  suggestionCard: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  suggestionLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  suggestionLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
  },
  suggestionLoadingText: { ...typography.caption, color: colors.textMuted },
  suggestionActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  useButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  useButtonText: { color: colors.onAccent, fontWeight: '600', fontSize: 14 },
  anotherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  anotherButtonText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  searchLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600', marginBottom: spacing.sm },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md, fontSize: 14, color: colors.text },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  songArt: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  songArtFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  songTitles: { flex: 1 },
  songTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  songArtist: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  previewButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noResults: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
});
