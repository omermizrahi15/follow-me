import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Song } from '../../domain/entities/Song';
import { usePreviewPlayer } from '../hooks/usePreviewPlayer';
import { colors, radius, spacing } from '../theme/theme';

/**
 * The posting's music bar (issue #54): artwork, title/artist and — when the
 * song carries a preview — a play/pause button for its 30s clip. Mirrors the
 * bar the subscriber web gallery shows for the same post.
 */
export function SongBar({ song }: { song: Song }): React.JSX.Element {
  const { playingUrl, toggle } = usePreviewPlayer();
  const playing = song.previewUrl != null && playingUrl === song.previewUrl;

  return (
    <View style={styles.bar}>
      {song.artworkUrl != null ? (
        <Image source={{ uri: song.artworkUrl }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.artworkFallback]}>
          <Ionicons name="musical-notes" size={18} color={colors.accent} />
        </View>
      )}
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>{song.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{song.artist}</Text>
      </View>
      {song.previewUrl != null && (
        <TouchableOpacity
          style={styles.playButton}
          onPress={() => toggle(song.previewUrl as string)}
          accessibilityLabel={playing ? 'Pause preview' : 'Play preview'}
          hitSlop={8}
        >
          <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.onAccent} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  artwork: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  artworkFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  titles: { flex: 1 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  artist: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
